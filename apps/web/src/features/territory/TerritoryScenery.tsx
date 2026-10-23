/** Small, readable silhouettes. All scenery is decorative; the tile owns interaction. */
function Pennant({ small = false }: { small?: boolean }) {
  return <g className={`territory-board__flag${small ? ' is-small' : ''}`} transform={small ? 'translate(23 -2) scale(.55)' : 'translate(2 -35)'}>
    <ellipse className="territory-board__object-shadow" cy="5" rx="10" ry="4" />
    <path className="territory-board__pole-shadow" d="M0 3V-49" />
    <path className="territory-board__pole" d="M-1 2V-50" />
    <path className="territory-board__pennant" d="M1-47Q15-52 32-39Q35-36 31-34Q15-26 1-30Z" />
    <path className="territory-board__pennant-light" d="M5-43Q16-46 25-39" />
    <circle className="territory-board__flag-ball" cy="-51" r="4" />
  </g>
}

function Tree({ x, y, size, gradient }: { x: number; y: number; size: number; gradient: string }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <ellipse className="territory-board__object-shadow" cy="4" rx="15" ry="6" />
    <path className="territory-board__trunk" d="M0 4V-22" />
    <g className="territory-board__leaves">
      <path d="M-16-22C-21-35-11-46-2-49C9-52 21-37 18-25C20-12 5-6-7-12C-15-11-19-16-16-22Z" fill={`url(#${gradient})`} />
      <path className="territory-board__leaf-light" d="M-10-32Q-11-40-3-42" />
    </g>
  </g>
}

export function TerritoryScenery({ capital, owned, variant, towers, leafGradient }: {
  capital: boolean; owned: boolean; variant: number; towers: number; leafGradient: string
}) {
  if (capital) return <g className="territory-board__capital" transform="translate(0 -8)">
    <ellipse className="territory-board__object-shadow" cy="7" rx="32" ry="12" />
    <g className={`territory-board__turret${towers < 3 ? ' is-down' : ''}`} transform="translate(0 -18)">
      <rect className="territory-board__plaster" x="-12" y="-28" width="24" height="38" rx="7" />
      <path className="territory-board__roof" d="M-16-27Q-17-30-12-34L-3-47Q0-51 4-46L16-31Q18-27 12-25Z" />
      <rect className="territory-board__window" x="-3" y="-20" width="6" height="10" rx="3" />
    </g>
    <rect className="territory-board__plaster" x="-25" y="-15" width="50" height="25" rx="9" />
    {[-22, 22].map((x, index) => <g key={x} className={`territory-board__turret${index >= towers ? ' is-down' : ''}`} transform={`translate(${x} 0)`}>
      <rect className="territory-board__plaster-side" x="-10" y="-23" width="20" height="32" rx="7" />
      <path className="territory-board__roof" d="M-13-22Q-14-25-9-29L-3-37Q0-41 4-36L13-25Q15-22 9-20Z" />
      <rect className="territory-board__window" x="-2.5" y="-13" width="5" height="7" rx="2.5" />
    </g>)}
    <path className="territory-board__door" d="M-6 10V0A6 6 0 0 1 6 0V10Z" />
    <Pennant />
  </g>
  if (owned) return <g className="territory-board__village" transform="translate(-4 -6)">
    <ellipse className="territory-board__object-shadow" cy="7" rx="25" ry="9" />
    <rect className="territory-board__plaster" x="-17" y="-21" width="35" height="28" rx="7" />
    <path className="territory-board__plaster-side" d="M10-18H18V1Q18 7 11 7H10Z" />
    <path className="territory-board__roof" d="M-23-20Q-25-23-20-27L-4-42Q0-45 4-42L25-25Q28-21 23-19L4-22Q0-20-5-20Z" />
    <path className="territory-board__roof-light" d="M-16-26L-3-37Q0-40 3-37" />
    <rect className="territory-board__window" x="-11" y="-12" width="7" height="8" rx="3" />
    <path className="territory-board__door" d="M3 7V-1A5 5 0 0 1 13-1V7Z" />
    <Pennant small />
  </g>
  return <g className="territory-board__grove" transform="translate(0 -5)">
    <Tree x={variant % 2 ? -9 : 0} y={0} size={variant % 2 ? .78 : 1} gradient={leafGradient} />
    {variant % 2 === 1 && <Tree x={15} y={3} size={.55} gradient={leafGradient} />}
    <ellipse className="territory-board__pebble" cx="23" cy="6" rx="5" ry="3" />
    <ellipse className="territory-board__pebble" cx="-22" cy="2" rx="3" ry="2" />
  </g>
}
