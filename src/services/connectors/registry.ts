import type { DataConnector } from "./types";

const connectors = new Map<string, DataConnector>();

export function registerConnector(connector: DataConnector): void {
  connectors.set(connector.type, connector);
}

export function getConnector(type: string): DataConnector | undefined {
  return connectors.get(type);
}

export function listConnectors(): DataConnector[] {
  return Array.from(connectors.values());
}
