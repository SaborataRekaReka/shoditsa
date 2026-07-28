import { describe, expect, it } from 'vitest'
import { contentReportReasonsForMode } from './ContentReport'

describe('contentReportReasonsForMode', () => {
  it('does not show Connections taxonomy in catalog games', () => {
    const diagnosisReasons = contentReportReasonsForMode('diagnosis').map(([reason]) => reason)

    expect(diagnosisReasons).not.toContain('ambiguous_group')
    expect(diagnosisReasons).not.toContain('wrong_group_title')
    expect(diagnosisReasons).toContain('wrong_fact')
  })

  it('keeps grouping reasons in Connections', () => {
    expect(contentReportReasonsForMode('connections').map(([reason]) => reason)).toContain('ambiguous_group')
  })
})
