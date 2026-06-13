#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { argv, exit, stderr, stdout } from "node:process";


export async function version(): Promise<number> {
    const url = new URL("../../package.json", import.meta.url);
    const raw: unknown = JSON.parse(await readFile(url, "utf8"));
    const packageVersion = (
        typeof raw === "object" &&
        raw !== null &&
        "version" in raw &&
        typeof raw.version === "string"
    ) ? raw.version : "0.0.0";


    stdout.write(`hedge v${await version()}\n`);
    return 0;
}
