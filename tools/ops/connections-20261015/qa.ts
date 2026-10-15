import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {sql} from 'drizzle-orm'
import {createDatabase} from '@shoditsa/database'
import {loadConfig} from '@shoditsa/config'
import {startConnectionsSession,submitConnectionsGuess} from '../../../apps/api/src/modules/connections/service.ts'
import {buildConnectionsRuntimeRound} from '@shoditsa/game-core'
const config=loadConfig()
const {db,client}=createDatabase(config)
const rollback=new Error('INTENTIONAL_QA_ROLLBACK')
let proof:Record<string,unknown>|undefined
const guessKey=randomUUID()
try{
  try{await db.transaction(async tx=>{
    const owner=await tx.execute(sql`select a.actor_user_id as id from audit_log a join player_profiles p on p.user_id=a.actor_user_id where a.action='growth.stage_changed' and p.role='admin' order by a."createdAt" desc limit 1`)
    if(!owner[0]?.id)throw Error('No verified staff actor')
    const userId=String(owner[0].id)
    const before=await tx.execute(sql`select (select count(*) from game_sessions where user_id=${userId})::int as sessions,(select count(*) from wallet_ledger where user_id=${userId})::int as ledger`)
    const session=await startConnectionsSession(tx as any,userId,{kind:'daily'},null,'admin',config)
    assert.equal(session.engine,'connections_grid')
    assert.equal(session.status,'playing')
    assert.equal(session.connections?.tiles.length,16)
    assert.equal(session.connections?.solvedGroups.length,0)
    const row=await tx.execute(sql`select v.payload from connections_schedule s join content_item_versions v on v.id=s.item_version_id where s.puzzle_date=${session.puzzleDate}`)
    const runtime=buildConnectionsRuntimeRound(row[0].payload as any)
    const result=await submitConnectionsGuess(tx as any,userId,'admin',session.id,runtime.groups[0].tileIds,guessKey,config)
    assert.equal(result.result,'correct')
    assert.equal(result.session.connections?.solvedGroups.length,1)
    assert.equal(result.session.connections?.mistakesUsed,0)
    proof={capturedAt:new Date().toISOString(),date:session.puzzleDate,engine:session.engine,tiles:16,start:'playing',correctGuessAccepted:true,firstGroup:runtime.groups[0].color,before,rolledBack:true,publicConnectionsEnabled:config.connectionsEnabled,resultKeys:Object.keys(result)}
    throw rollback
  })}catch(error){if(error!==rollback)throw error}
  const persisted=await db.execute(sql`select count(*)::int as n from connections_guesses where idempotency_key=${guessKey}`)
  assert.equal(persisted[0]?.n,0)
  console.log(JSON.stringify(proof))
}finally{await client.end()}
