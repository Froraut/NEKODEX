import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildTrustedMcpSandboxLaunch, reviewTrustedSandboxConfig, sandboxProviderAvailable } from "../src/agent-tools/sandbox";

async function run(command: string, args: string[], options: { cwd: string; env: Record<string, string> }) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; pid: number }>((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = []; const errors: Buffer[] = []; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 8000);
    child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk));
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("Owned sandbox fixture timed out and was reaped"));
      else resolve({ code, signal, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(), pid: child.pid! });
    });
  });
}
const source = `#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
static int denied(const char *p,int flags) { errno=0; int f=open(p,flags,0600); if(f>=0){close(f);return 0;} return errno==EPERM||errno==EACCES; }
static int restrictions(char **v) {
  struct stat st; int metadata=stat(v[3],&st)==0;
  int outside=denied(v[3],O_RDONLY), outsideWrite=denied(v[4],O_WRONLY|O_CREAT);
  int s=socket(AF_INET,SOCK_STREAM,0), network=0;
  if(s<0) network=errno==EPERM||errno==EACCES;
  else { struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_port=htons(atoi(v[5]));inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);
    errno=0;int c=connect(s,(struct sockaddr*)&a,sizeof(a));network=c<0&&(errno==EPERM||errno==EACCES);close(s); }
  return metadata&&outside&&outsideWrite&&network;
}
int main(int n,char **v) {
  if(n!=6)return 10; char b[16]={0}; int f=open(v[1],O_RDONLY);if(f<0)return 11;
  int count=read(f,b,sizeof(b));close(f);if(count!=7||memcmp(b,"allowed",7))return 12;
  f=open(v[2],O_WRONLY|O_CREAT|O_EXCL,0600);if(f<0)return 13;
  if(write(f,"written",7)!=7)return 14;close(f);
  if(!restrictions(v))return 15;
  pid_t child=fork();if(child<0)return 16;
  if(child==0)_exit(restrictions(v)?0:17);
  int status=0;if(waitpid(child,&status,0)!=child||!WIFEXITED(status)||WEXITSTATUS(status)!=0)return 18;
  printf("{\\"allowedRead\\":true,\\"allowedWrite\\":true,\\"outsideReadDenied\\":true,\\"outsideWriteDenied\\":true,\\"localTcpDenied\\":true,\\"metadataVisible\\":true,\\"forkChildDenied\\":true,\\"childReaped\\":true}\\n");return 0;
}`;

test("requested isolation fails closed on unsupported platforms", () => {
  expect(sandboxProviderAvailable("linux")).toBe(false); expect(sandboxProviderAvailable("win32")).toBe(false);
  expect(() => buildTrustedMcpSandboxLaunch({ platform: "linux" } as any)).toThrow("unavailable");
});

test.skipIf(process.platform !== "darwin")("real macOS Seatbelt grants selected bytes and kernel-denies outside data/network including a reaped fork child", async () => {
  expect(sandboxProviderAvailable()).toBe(true);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nk-seatbelt-")));
  const directories = Object.fromEntries(["code", "read", "write", "home", "tmp", "outside"].map(name => {
    const path = join(root, name); mkdirSync(path, { mode: 0o700 }); return [name, path];
  }));
  let accepted = 0; const server = createServer(socket => { accepted++; socket.destroy(); });
  try {
    const input = join(directories.read!, "input.txt"); const output = join(directories.write!, "output.txt");
    const outside = join(directories.outside!, "synthetic-private.txt"); const outsideWrite = join(directories.outside!, "unexpected.txt");
    writeFileSync(input, "allowed"); writeFileSync(outside, "SYNTHETIC_OUTSIDE_CONTENT");
    const c = join(directories.code!, "probe.c"); const executable = join(directories.code!, "probe"); writeFileSync(c, source);
    const compile = await run("/usr/bin/clang", [c, "-o", executable], { cwd: directories.code!, env: { PATH: "/usr/bin:/bin", HOME: directories.home!, TMPDIR: directories.tmp! } });
    expect({ code: compile.code, signal: compile.signal, stderr: compile.stderr }).toEqual({ code: 0, signal: null, stderr: "" });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const config = reviewTrustedSandboxConfig({ codeRoots: [directories.code!], readRoots: [directories.read!], writeRoots: [directories.write!] });
    const parameters = { config, executable, executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
      args: [input, output, outside, outsideWrite, String(port)], cwd: directories.read!, privateHome: directories.home!, privateTmp: directories.tmp! };
    const spec = buildTrustedMcpSandboxLaunch(parameters); spec.assertCurrent();
    expect(spec.env.HOME).toBe(directories.home!); expect(spec.env.TMPDIR).toBe(directories.tmp!);
    expect(Object.keys(spec.env).sort()).toEqual(["HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP", "TMPDIR"]);
    expect(spec.boundary.filesystemMetadata).toBe("all-paths");
    const receipt = await run(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
    expect({ code: receipt.code, signal: receipt.signal, stderr: receipt.stderr }).toEqual({ code: 0, signal: null, stderr: "" });
    expect(JSON.parse(receipt.stdout)).toEqual({ allowedRead: true, allowedWrite: true, outsideReadDenied: true, outsideWriteDenied: true,
      localTcpDenied: true, metadataVisible: true, forkChildDenied: true, childReaped: true });
    expect(readFileSync(output, "utf8")).toBe("written"); expect(readFileSync(outside, "utf8")).toBe("SYNTHETIC_OUTSIDE_CONTENT");
    expect(existsSync(outsideWrite)).toBe(false); expect(accepted).toBe(0);
    expect(() => process.kill(receipt.pid, 0)).toThrow();
    expect(() => reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [join(root, 'bad"root')], writeRoots: [] })).toThrow("profile escapes");
    expect(() => buildTrustedMcpSandboxLaunch({ ...parameters, args: ["bad\0arg"] })).toThrow("arguments");
    expect(() => buildTrustedMcpSandboxLaunch({ ...parameters, executableSha256: "0".repeat(64) })).toThrow("pin changed");
    renameSync(directories.read!, `${directories.read!}-old`); mkdirSync(directories.read!, { mode: 0o700 });
    expect(() => spec.assertCurrent()).toThrow("root changed");
    expect(() => buildTrustedMcpSandboxLaunch(parameters)).toThrow("root changed");
    rmSync(directories.read!, { recursive: true }); symlinkSync(`${directories.read!}-old`, directories.read!);
    expect(() => spec.assertCurrent()).toThrow("symbolic links");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}, 15000);

test.skipIf(process.platform !== "darwin")("official SDK initializes, discovers and calls the local MCP fixture through the sandbox wrapper", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nk-mcp-seatbelt-")));
  const home = join(root, "home"); const temporary = join(root, "tmp"); const allowed = join(root, "allowed");
  for (const path of [home, temporary, allowed]) mkdirSync(path, { mode: 0o700 });
  const fixture = realpathSync(join(import.meta.dir, "fixtures", "agent-tools-server.ts"));
  const fixtureRoot = realpathSync(join(import.meta.dir, "fixtures"));
  const dependencies = realpathSync(join(import.meta.dir, "..", "node_modules"));
  const executable = realpathSync(process.execPath); const counter = join(allowed, "counter.txt");
  const spec = buildTrustedMcpSandboxLaunch({
    config: reviewTrustedSandboxConfig({ codeRoots: [fixtureRoot, dependencies], readRoots: [], writeRoots: [allowed] }),
    executable, executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), args: [fixture, counter],
    cwd: fixtureRoot, privateHome: home, privateTmp: temporary,
  });
  const transport = new StdioClientTransport({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env, stderr: "pipe" });
  let fixtureDiagnostics = "";
  transport.stderr?.on("data", chunk => { fixtureDiagnostics = (fixtureDiagnostics + String(chunk)).slice(-4000); });
  const client = new Client({ name: "nekodex-sandbox-integration-fixture", version: "1.0.0" }, { capabilities: {} });
  let pid: number | null = null;
  try {
    spec.assertCurrent();
    try { await client.connect(transport, { timeout: 3000, maxTotalTimeout: 3000 }); }
    catch { throw new Error(`Owned sandbox MCP fixture initialization failed: ${fixtureDiagnostics}`); }
    pid = transport.pid;
    expect(typeof pid).toBe("number");
    const tools = await client.listTools({}, { timeout: 1000 }); expect(tools.tools.some(tool => tool.name === "record")).toBe(true);
    const result = await client.callTool({ name: "record", arguments: { text: "synthetic sandbox call" } }, undefined, { timeout: 1000 });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual({ count: 1, text: "synthetic sandbox call" });
    expect(readFileSync(counter, "utf8")).toBe("1");
  } finally {
    await client.close(); await transport.close(); rmSync(root, { recursive: true, force: true });
  }
  if (pid !== null) expect(() => process.kill(pid!, 0)).toThrow();
}, 7000);
