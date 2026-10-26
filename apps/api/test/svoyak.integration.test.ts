import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { mergeAnonymousAccount } from '../src/modules/auth/merge.js'
import { loadConfig } from '@shoditsa/config'
import { createDatabase, user, userEntitlements } from '@shoditsa/database'
import type { Auth } from '../src/modules/auth/auth.js'
import { sendError } from '../src/lib/errors.js'
import { registerSvoyakRoutes } from '../src/modules/svoyak/routes.js'
import type { Bank } from '@shoditsa/game-core/svoyak-bank'
import type { Command, Credentials, RoomView } from '@shoditsa/contracts/svoyak'

const origin = 'http://localhost:5180'
const actors = [randomUUID(),randomUUID(),randomUUID(),randomUUID()]
const config = { ...loadConfig(),svoyakEnabled:true,trustedOrigins:[origin] }
const database = createDatabase(config)
const fakeAuth = { api: { getSession: async ({headers}:{headers:Headers}) => {
  const id = headers.get('cookie')?.replace('qa=','')
  return id && actors.includes(id as typeof actors[number]) ? { user: {id,email:`${id}@example.test`,name:'Svoyak QA',isAnonymous:id!==actors[0]},session:{id:randomUUID()} } : null
} } } as unknown as Auth
const applications: FastifyInstance[]=[]
async function application() {
  const app=Fastify(); await app.register(rateLimit,{max:1,timeWindow:'1 minute'})
  app.setErrorHandler((error,request,reply)=>sendError(request,reply,error))
  registerSvoyakRoutes(app,{db:database.db,auth:fakeAuth,config});await app.ready();applications.push(app);return app
}
let app:FastifyInstance,release:Bank
const headers=(actor=0,token?:string)=>({origin,cookie:`qa=${actors[actor]}`,...(token?{authorization:`Bearer ${token}`}:{})})
async function create() {
 const response=await app.inject({method:'POST',url:'/api/v1/svoyak/rooms',headers:headers(),payload:{name:'QA Ведущий',avatar:'cat',settings:{rounds:1,themesPerRound:1,secondsPerQuestion:30,age:18}}})
 expect(response.statusCode,response.body).toBe(201);return response.json() as {credentials:Credentials;room:RoomView}
}
async function join(code:string,actor:number) {
 const response=await app.inject({method:'POST',url:`/api/v1/svoyak/rooms/${code}/join`,headers:headers(actor),payload:{name:`QA Игрок ${actor}`,avatar:'fox'}})
 expect(response.statusCode,response.body).toBe(201);return response.json().credentials as Credentials
}
async function command(who:Credentials,actor:number,value:Command,commandId:string=randomUUID()) {
 return app.inject({method:'POST',url:`/api/v1/svoyak/rooms/${who.code}/commands`,headers:headers(actor,who.token),payload:{command:value,commandId}})
}
async function ok(who:Credentials,actor:number,value:Command,commandId?:string) {
 const result=await command(who,actor,value,commandId);expect(result.statusCode,result.body).toBe(200);return result.json() as RoomView
}
async function company() {
 const host=(await create()).credentials,first=await join(host.code,1),second=await join(host.code,2)
 await ok(first,1,{type:'ready',ready:true});await ok(second,2,{type:'ready',ready:true})
 await ok(host,0,{type:'prepare'});return {host,first,second}
}

describe('Svoyak production API and PostgreSQL',()=>{
 beforeAll(async()=>{
  const dbUrl=new URL(config.databaseUrl)
  const ciFixture=process.env.CI==='true'&&['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname)&&dbUrl.pathname==='/shoditsa'
  if(config.production||!ciFixture&&(dbUrl.hostname!=='127.0.0.1'||dbUrl.pathname!=='/svoyak_test'))throw Error('Requires the isolated loopback svoyak_test database')
  await database.db.insert(user).values(actors.map((id,index)=>({id,email:`${id}@example.test`,name:`QA ${index}`,isAnonymous:index!==0})))
  await database.db.insert(userEntitlements).values({userId:actors[0],entitlementKey:'club',sourceType:'admin',sourceId:randomUUID(),startsAt:new Date(Date.now()-10000)})
  release=JSON.parse(await readFile('data/svoyak/release-v1.json','utf8'))
  await database.db.execute(sql`insert into svoyak_content_revisions(id,status,catalog,provenance) values(${release.catalog.revision},'active',${JSON.stringify(release.catalog)}::jsonb,'{}') on conflict(id) do update set status='active'`)
  await database.db.execute(sql`insert into svoyak_questions(revision_id,id,content_hash,payload) select ${release.catalog.revision},q->>'id',q->>'hash',q from jsonb_array_elements(${JSON.stringify(release.questions)}::jsonb) q on conflict do nothing`)
  app=await application()
 },120000)
 afterAll(async()=>{await Promise.all(applications.map(app=>app.close()));await database.client.end()})
 it('publishes metadata without answer keys and rejects a guest creator and foreign Origin',async()=>{
  const catalog=await app.inject({method:'GET',url:'/api/v1/svoyak/catalog',headers:headers()})
  expect(catalog.statusCode).toBe(200);expect(catalog.json().localOnly).toBe(false);expect(catalog.body).not.toContain('"answer"');expect(catalog.body).not.toContain('"prompt"')
  const guest=await app.inject({method:'POST',url:'/api/v1/svoyak/rooms',headers:headers(1),payload:{name:'QA',avatar:'cat',settings:{rounds:1,themesPerRound:1,secondsPerQuestion:30,age:18}}})
  expect(guest.statusCode).toBe(403)
  const foreign=await app.inject({method:'POST',url:'/api/v1/svoyak/rooms',headers:{...headers(),origin:'https://foreign.test'},payload:{name:'QA',avatar:'cat',settings:{rounds:1,themesPerRound:1,secondsPerQuestion:30,age:18}}})
  expect(foreign.statusCode).toBe(403)
 },30000)
 it('plays all five questions, resolves simultaneous buzz, prevents double scoring and survives a new API instance',async()=>{
  const {host,first,second}=await company();let room=await ok(host,0,{type:'start'})
  const hidden=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`})
  expect(hidden.json().board).toEqual([]);expect(hidden.json().current).toBeNull();expect(hidden.body).not.toContain('tokenHash');expect(hidden.body).not.toContain('userId')
  const wrongAccount=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`,headers:headers(3,host.token)})
  expect(wrongAccount.statusCode).toBe(401)
  let expectedScore=0,firstQuestion=true
  for(const question of room.board.flatMap(theme=>theme.questions)) {
    room=await ok(host,0,{type:'choose',questionId:question.id})
    const buzzes=await Promise.all([command(first,1,{type:'buzz'}),command(second,2,{type:'buzz'})])
    expect(buzzes.map(result=>result.statusCode).sort()).toEqual([200,409])
    const winnerIndex=buzzes.findIndex(result=>result.statusCode===200),winner=winnerIndex===0?first:second,actor=winnerIndex+1
    room=buzzes[winnerIndex].json();expect(room.current?.answer).toBeUndefined()
    const reveal=await ok(host,0,{type:'reveal'});expect(reveal.current?.answer?.text).toBeTruthy()
    const playerView=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`,headers:headers(actor,winner.token)})
    expect(playerView.json().current.answer).toBeUndefined()
    const id=randomUUID();room=await ok(host,0,{type:'judge',correct:true},id);expectedScore+=room.current!.points
    const repeated=await ok(host,0,{type:'judge',correct:true},id)
    expect(repeated.members.map(member=>member.score)).toEqual(room.members.map(member=>member.score))
    room=await ok(host,0,{type:'next'}); console.log('svoyak complete question',room.played,room.stage)
    if(firstQuestion) {app=await application();firstQuestion=false;const restored=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`,headers:headers(0,host.token)});expect(restored.json().played).toBe(1)}
  }
  expect(room.stage).toBe('result');expect(room.completed).toBe(true);expect(room.members.reduce((sum,m)=>sum+m.score,0)).toBe(expectedScore)
  expect((await database.db.execute(sql`select count(*)::int as count from svoyak_answer_events where room_code=${host.code}`))[0].count).toBe(5)
  expect((await database.db.execute(sql`select count(*)::int as count from svoyak_results where room_code=${host.code}`))[0].count).toBe(1)
  expect((await database.db.execute(sql`select count(*)::int as count from svoyak_analytics_outbox where room_code=${host.code}`))[0].count).toBe(1)
  await ok(host,0,{type:'rematch'});const rematch=await ok(host,0,{type:'prepare'});expect(rematch.plan).toBeTruthy()
 },300000)
 it('refuses withdrawn questions at the transaction boundary and expires old rooms',async()=>{
  const {host}=await company();const room=await ok(host,0,{type:'start'});const question=room.board[0].questions[0]
  await database.db.execute(sql`update svoyak_questions set approved=false where revision_id=${release.catalog.revision} and id=${question.id}`)
  try {const response=await command(host,0,{type:'choose',questionId:question.id});expect(response.statusCode).toBe(409)}
  finally {await database.db.execute(sql`update svoyak_questions set approved=true where revision_id=${release.catalog.revision} and id=${question.id}`)}
  await database.db.execute(sql`update svoyak_rooms set expires_at=now()-interval '1 second' where code=${host.code}`)
  const expired=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`,headers:headers(0,host.token)})
  expect(expired.statusCode).toBe(404)
 },60000)
 it('preserves a room capability when a guest links to a permanent account',async()=>{
  const host=(await create()).credentials,player=await join(host.code,1)
  await mergeAnonymousAccount(database.db,actors[1],actors[3])
  await database.db.execute(sql`delete from "user" where id=${actors[1]}`)
  const restored=await app.inject({method:'GET',url:`/api/v1/svoyak/rooms/${host.code}`,headers:headers(3,player.token)})
  expect(restored.statusCode,restored.body).toBe(200);expect(restored.json().me.id).toBe(player.memberId)
 },120000)

})
