type ConnectionsStartDateSources = {
  argument?: string
  configured?: string | null
  stored?: string
  today: string
}

export const resolveConnectionsStartDate = ({
  argument,
  configured,
  stored,
  today,
}: ConnectionsStartDateSources) => argument ?? configured ?? stored ?? today
