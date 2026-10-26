// Explicit, single-use content release. No active card is edited in place.
import {createDatabase} from '../../../packages/database/src/client.ts'
import {saveWorkspaceItem,buildWorkspaceRevision,activateWorkspaceRevision,validateContentPayload} from '../../../apps/api/src/modules/admin/content-service.ts'
import {contentWorkspaces,contentWorkspaceChanges,contentItems,contentItemVersions,contentRevisions,auditLog,connectionsSchedule} from '@shoditsa/database'
import {eq,and,inArray,sql} from 'drizzle-orm'
import {document} from '../../content/connections-20261015.mjs'

const expectedBase='62f9f575-1b7d-4a30-b52a-eaaa51449c1a'
const workspaceId='c818efc2-e33a-45e5-94b5-a27d04ddc547'
const start='2026-10-15'
const requestId='ops:connections-restore:2026-10-15'
const reason='Owner requested restoration and 14-day reserve on 2026-10-15; new editorially reviewed Connections rounds only'
const {db,client}=createDatabase({databaseUrl:process.env.DATABASE_URL!,databasePoolMax:2})
try {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  if(today!==start) throw Error('Date changed: revise plan before writing')
  const owner=await db.execute(sql`select a.actor_user_id as id from audit_log a join player_profiles p on p.user_id=a.actor_user_id where a.action='growth.stage_changed' and p.role='admin' order by a."createdAt" desc limit 1`)
  if(!owner[0]?.id)throw Error('Verified owner actor missing')
  const actor={id:String(owner[0].id)}
  const active=(await db.select().from(contentRevisions).where(eq(contentRevisions.status,'active')))[0]
  const workspace=(await db.select().from(contentWorkspaces).where(eq(contentWorkspaces.id,workspaceId)))[0]
  const drafts=await db.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId,workspaceId))
  if(active?.id!==expectedBase||workspace?.baseRevisionId!==expectedBase||workspace?.status!=='open'||drafts.length)throw Error('Active/workspace changed; no writes')
  if(document.rounds.length!==14)throw Error('Exactly fourteen reviewed rounds required')
  const ids=document.rounds.map(r=>`connections:${r.id}`)
  if(new Set(ids).size!==14)throw Error('Duplicate new round IDs')
  const payloads=document.rounds.map((r,i)=>({...r,id:ids[i],externalId:r.id,mode:'connections',titleRu:`Связи — ${r.id}`,titleOriginal:'',alternativeTitles:[],schemaVersion:1,locale:'ru',contentStatus:'ready',allowedInGame:true,popularityScore:0}))
  for(const payload of payloads){
    const errors=validateContentPayload(payload,'connections').filter(x=>x.level==='error')
    if(errors.length)throw Error(JSON.stringify({id:payload.id,errors}))
  }
  const dates=ids.map((_,i)=>new Date(Date.parse(start+'T12:00:00Z')+i*86400000).toISOString().slice(0,10))
  // Entire staging/build/activation/schedule is atomic; unrelated drafts cannot be merged.
  const receipt=await db.transaction(async tx=>{
    await tx.execute(sql`set local lock_timeout='10s'`)
    await tx.execute(sql`set local statement_timeout='120s'`)
    await tx.execute(sql`lock table content_workspaces,content_workspace_changes,connections_schedule in share row exclusive mode`)
    const current=(await tx.select().from(contentRevisions).where(eq(contentRevisions.status,'active')).for('update'))[0]
    const currentWorkspace=(await tx.select().from(contentWorkspaces).where(eq(contentWorkspaces.id,workspaceId)))[0]
    const stillClean=await tx.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId,workspaceId))
    if(current?.id!==expectedBase||stillClean.length||currentWorkspace?.baseRevisionId!==expectedBase||currentWorkspace?.status!=='open')throw Error('Concurrent content change; aborted')
    if((await tx.select({id:contentItems.id}).from(contentItems).where(inArray(contentItems.id,ids))).length)throw Error('A proposed round ID already existed; aborted')
    const existing=await tx.execute(sql`select puzzle_date from connections_schedule where puzzle_date>=${dates[0]} and puzzle_date<=${dates.at(-1)}`)
    if(existing.length)throw Error('Schedule already occupied; aborted')
    for(const payload of payloads)await saveWorkspaceItem(tx as any,actor,payload.id,{mode:'connections',payload,expectedVersion:0,source:'import',reason},requestId)
    const staged=await tx.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId,workspaceId))
    if(staged.length!==ids.length||staged.some(c=>!ids.includes(c.itemId)))throw Error('Unexpected staged cards; aborted')
    const built=await buildWorkspaceRevision(tx as any,actor,workspaceId,requestId)
    const difference=await tx.execute(sql`select count(*)::int as n from content_item_versions old left join content_item_versions fresh on fresh.item_id=old.item_id and fresh.revision_id=${built.revisionId} where old.revision_id=${expectedBase} and (fresh.id is null or old.payload is distinct from fresh.payload or old.allowed_in_game is distinct from fresh.allowed_in_game or old.content_status is distinct from fresh.content_status)`)
    if(Number(difference[0]?.n)!==0)throw Error('Previously live content differs; not activated')
    const extra=await tx.execute(sql`select item_id from content_item_versions fresh where fresh.revision_id=${built.revisionId} and not exists(select 1 from content_item_versions old where old.revision_id=${expectedBase} and old.item_id=fresh.item_id)`)
    if(extra.length!==14||extra.some(x=>!ids.includes(String(x.item_id))))throw Error('Unexpected added content; not activated')
    const vignetteDiff=await tx.execute(sql`with a as (select v.item_id,jsonb_agg(d.text order by d.sort_order,d.text) as texts from content_item_versions v join diagnosis_vignettes d on d.item_version_id=v.id where v.revision_id=${expectedBase} group by v.item_id), b as (select v.item_id,jsonb_agg(d.text order by d.sort_order,d.text) as texts from content_item_versions v join diagnosis_vignettes d on d.item_version_id=v.id where v.revision_id=${built.revisionId} group by v.item_id) select count(*)::int n from a full join b using(item_id) where a.texts is distinct from b.texts`)
    if(Number(vignetteDiff[0]?.n)!==0)throw Error('Diagnosis vignettes changed; not activated')
    const versions=await tx.select().from(contentItemVersions).where(and(eq(contentItemVersions.revisionId,built.revisionId),eq(contentItemVersions.mode,'connections')))
    const selected=ids.map(id=>versions.find(v=>v.itemId===id))
    if(selected.some(v=>!v||!v.allowedInGame||v.contentStatus!=='ready'))throw Error('Unready new round')
    const activated=await activateWorkspaceRevision(tx as any,actor,workspaceId,requestId)
    await tx.insert(connectionsSchedule).values(selected.map((v,i)=>({puzzleDate:dates[i],itemVersionId:v!.id,scheduledBy:actor.id})))
    await tx.insert(auditLog).values({actorUserId:actor.id,action:'connections.schedule.bulk',entityType:'connections_schedule',entityId:`${dates[0]}:${dates.at(-1)}`,before:null,after:{dates,itemVersionIds:selected.map(v=>v!.id)},reason,requestId})
    return {revisionId:activated.revision.id,version:activated.revision.version,counts:built.counts,dates,roundIds:ids,unchangedExistingCards:true,unchangedDiagnosisVignettes:true}
  })
  console.log(JSON.stringify({capturedAt:new Date().toISOString(),receipt}))
}finally{await client.end()}
