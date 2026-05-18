declare module "sql.js" {
  export interface SqlDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqlStatement;
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }

  export interface SqlStatement {
    bind(values?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer) => SqlDatabase;
  }

  export default function initSqlJs(config?: { wasmBinary?: Buffer }): Promise<SqlJsStatic>;
}
