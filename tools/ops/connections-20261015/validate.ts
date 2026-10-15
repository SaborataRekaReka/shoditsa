import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {document} from '../../content/connections-20261015.mjs'
import {validateContentPayload} from '../../../apps/api/src/modules/admin/content-service.ts'
import {buildConnectionsRuntimeRound,validateConnectionsRound} from '@shoditsa/game-core'
const failures=[]
for(const round of document.rounds){
  const payload={...round,id:`connections:${round.id}`,externalId:round.id,mode:'connections',titleRu:`Связи — ${round.id}`,titleOriginal:'',alternativeTitles:[],schemaVersion:1,locale:'ru',contentStatus:'ready',allowedInGame:true,popularityScore:0}
  const issues=[...validateContentPayload(payload,'connections'),...validateConnectionsRound(payload)]
  if(issues.length)failures.push({id:payload.id,issues})
  const runtime=buildConnectionsRuntimeRound(payload as any)
  assert(runtime)
}
console.log(JSON.stringify({rounds:document.rounds.length,documentSha256:createHash('sha256').update(JSON.stringify(document)).digest('hex'),failures},null,2))
const acknowledged=new Set(['connections:ru-20261015-12','connections:ru-20261015-14'])
const blocking=failures.flatMap(entry=>entry.issues.filter(issue=>!(acknowledged.has(entry.id)&&issue.code==='editorial.trap_missing'&&(issue.level==='warning'||issue.severity==='warning'))))
assert.equal(blocking.length,0,'Only two explicitly reviewed trap_missing warnings are allowed')
