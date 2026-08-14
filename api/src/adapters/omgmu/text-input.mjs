import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readOmgmuSourceText(input) {
  const filename = path.resolve(input);
  if (path.extname(filename).toLowerCase() !== ".pdf") {
    return fs.readFile(filename, "utf8");
  }
  const { stdout } = await execFileAsync("pdftotext", ["-layout", filename, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}
