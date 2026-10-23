/** The same two strokes bend from a handle into a directional chevron. */
export function StudyPanelGripIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg className="study-panel-grip-icon" data-direction={direction} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
    <path className="study-panel-grip-arm study-panel-grip-arm--top" d="M12 12V4" />
    <path className="study-panel-grip-arm study-panel-grip-arm--bottom" d="M12 12V20" />
  </svg>
}
