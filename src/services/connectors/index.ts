import { registerConnector } from "./registry";
import { CsvConnector } from "./csv";
import { RestConnector } from "./rest";

registerConnector(new CsvConnector());
registerConnector(new RestConnector());

export * from "./types";
export * from "./registry";
export { CsvConnector } from "./csv";
export { RestConnector } from "./rest";
