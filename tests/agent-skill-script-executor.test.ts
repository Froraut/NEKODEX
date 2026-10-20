import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillScriptExecutor } from "../src/agent-tools/skill-script-executor";
import { reviewTrustedSandboxConfig } from "../src/agent-tools/sandbox";

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const scope = { taskId: "fixture", generation: 1, toolCallId: "call" };
const resource = (code: string) => [{ relativePath: "scripts/run.mjs", bytes: Buffer.from(code) }];

test.skipIf(process.platform !== "darwin")("pinned selected script: kernel boundary, bounded output, cancellation and core owner loss", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-script-boundary-")));
  const home = join(root, "executor"), workspace = join(root, "workspace"), other = join(root, "ungranted.txt");
  mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 }); writeFileSync(other, "private fixture");
  const bunPath = realpathSync(process.execPath), bunSha256 = sha(readFileSync(bunPath));
  const executor = new SkillScriptExecutor({ bunPath, bunSha256, home });
  const previousSecret = process.env.NEKODEX_SCRIPT_TEST_SECRET; process.env.NEKODEX_SCRIPT_TEST_SECRET = "fixture-only-secret";
  const grant = reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [workspace], writeRoots: [workspace] });
  const common = { scope, argv: [], readRoots: grant.readRoots, writeRoots: grant.writeRoots, cwd: workspace, entryRelativePath: "scripts/run.mjs" };
  try {
    expect(executor.capabilities().available).toBe(true);
    const result = await executor.execute({ ...common, operationId: "kernel", resources: resource(`
      import fs from 'node:fs'; import {dlopen} from 'bun:ffi';
      const facts={env:process.env.NEKODEX_SCRIPT_TEST_SECRET ?? null};
      fs.writeFileSync(${JSON.stringify(join(workspace, "allowed.txt"))}, 'allowed'); facts.write=true;
      for (const [key, fn] of [ ['read',()=>fs.readFileSync(${JSON.stringify(other)})], ['writeOutside',()=>fs.writeFileSync(${JSON.stringify(other)},'changed')], ['codeWrite',()=>fs.writeFileSync(import.meta.filename,'changed')], ['spawn',()=>Bun.spawnSync(['/usr/bin/true'])] ]) { try{fn();facts[key]=false;}catch{facts[key]=true;} }
      const ffi=dlopen('/usr/lib/libSystem.B.dylib',{fork:{args:[],returns:'i32'},execve:{args:['cstring','ptr','ptr'],returns:'i32'},socket:{args:['i32','i32','i32'],returns:'i32'},connect:{args:['i32','ptr','u32'],returns:'i32'},__error:{args:[],returns:'ptr'},close:{args:['i32'],returns:'i32'}});
      facts.fork=ffi.symbols.fork()===-1; facts.exec=ffi.symbols.execve('/usr/bin/true',null,null)===-1;
      const sock=ffi.symbols.socket(2,1,0); const addr=Buffer.from([16,2,0,9,127,0,0,1,0,0,0,0,0,0,0,0]); const connected=ffi.symbols.connect(sock,addr,16); const {read}=await import('bun:ffi'); const errno=read.i32(ffi.symbols.__error()); facts.network=connected===-1&&[1,13].includes(errno); ffi.symbols.close(sock);
      console.log(JSON.stringify(facts));
    `) });
    if(result.state!=="completed") console.log("executor failure",result);
    expect(result.state).toBe("completed");
    expect(result.owner?.sealed).toBe(true); expect(result.owner?.reaped).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual({ env: null, write: true, read: true, writeOutside: true, codeWrite: true, spawn: true, fork: true, exec: true, network: true });
    expect(readFileSync(other, "utf8")).toBe("private fixture");
    expect(readFileSync(join(workspace, "allowed.txt"), "utf8")).toBe("allowed");
    expect(result.boundary?.processExec).toBe("deny");
    const output = await executor.execute({ ...common, operationId: "output", maxOutputBytes: 1024, resources: resource("console.log('x'.repeat(8000)); setInterval(()=>{},1000)") });
    expect(output.state).toBe("failed"); expect(output.truncated).toBe(true); expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(1024); expect(output.owner?.reaped).toBe(true);
    const timeout = await executor.execute({ ...common, operationId: "timeout", timeoutMs: 200, resources: resource("setInterval(()=>{},1000)") });
    expect(timeout.owner?.reason).toBe("timeout"); expect(timeout.owner?.reaped).toBe(true);
    const controller = new AbortController();
    const pending = executor.execute({ ...common, operationId: "cancel", signal: controller.signal, resources: resource("setInterval(()=>{},1000)") });
    await sleep(150); controller.abort(); const cancel = await pending;
    expect(cancel.state).toBe("failed"); expect(cancel.owner?.reaped).toBe(true);
    const duplicate = await executor.execute({ ...common, operationId: "kernel", resources: resource("console.log('replayed')") });
    expect(duplicate.stdout).toBe(result.stdout);
    expect(executor.reconcile("kernel")?.state).toBe("completed");

    // A separate core owner is killed; its trusted leaf observes control-pipe EOF.
    const worker = join(root, "core-owner.mjs");
    writeFileSync(worker, `import {SkillScriptExecutor} from ${JSON.stringify(new URL("../src/agent-tools/skill-script-executor.ts", import.meta.url).pathname)};
      const e=new SkillScriptExecutor(${JSON.stringify({ bunPath, bunSha256, home })});
      await e.execute({...${JSON.stringify(common)},operationId:'core-eof',resources:[{relativePath:'scripts/run.mjs',bytes:Buffer.from('setInterval(()=>{},1000)')}]});`);
    const core = Bun.spawn([bunPath, "--no-env-file", "--no-install", worker], { stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", HOME: root } });
    let receipt = executor.reconcile("core-eof");
    const deadline = Date.now() + 4000;
    while (!receipt?.owner?.sealed && Date.now() < deadline) { await sleep(40); receipt = executor.reconcile("core-eof"); }
    expect(receipt?.owner?.sealed).toBe(true);
    core.kill("SIGKILL"); await core.exited;
    while (!receipt?.owner?.reaped && Date.now() < deadline) { await sleep(40); receipt = executor.reconcile("core-eof"); }
    expect(receipt?.owner?.reason).toBe("core-owner-eof"); expect(receipt?.owner?.reaped).toBe(true);
    expect(receipt?.state).toBe("failed");
    expect(() => process.kill(receipt!.owner!.child!.pid, 0)).toThrow();
    console.log("Script fixture receipt:", JSON.stringify({ kernel: result.owner, output: output.owner, timeout: timeout.owner, cancellation: cancel.owner, coreOwnerEOF: receipt?.owner }));
  } finally {
    await executor.close();
    if(previousSecret === undefined) delete process.env.NEKODEX_SCRIPT_TEST_SECRET; else process.env.NEKODEX_SCRIPT_TEST_SECRET=previousSecret;
    // Retained immutable staged directories are fixture-owned, so explicitly restore owner cleanup mode.
    function unlock(path: string) { const fs = require('node:fs'); if (!existsSync(path)) return; const st=fs.lstatSync(path); if(st.isDirectory()){fs.chmodSync(path,0o700);for(const n of fs.readdirSync(path))unlock(join(path,n));} }
    unlock(root); rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(process.platform !== "darwin")("supervisor death remains unknown with exact retained child identity", async () => {
  const fs = await import("node:fs");
  const { dlopen, ptr } = await import("bun:ffi");
  const proc = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
  const identity = (pid: number) => { const b=Buffer.alloc(136); if(proc.symbols.proc_pidinfo(pid,3,0,ptr(b),136)!==136)return undefined;return `${b.readBigUInt64LE(120)}:${b.readBigUInt64LE(128)}`; };
  const root=realpathSync(mkdtempSync(join(tmpdir(),"nekodex-script-owner-death-")));
  const bunPath=realpathSync(process.execPath);
  const executor=new SkillScriptExecutor({bunPath,bunSha256:sha(readFileSync(bunPath)),home:root});
  let childIdentity: { pid: number; start: string } | null | undefined;
  let restarted: SkillScriptExecutor | undefined;
  try {
    const pending=executor.execute({scope,operationId:"supervisor-death",entryRelativePath:"scripts/run.mjs",resources:resource("setInterval(()=>{},1000)"),readRoots:[],writeRoots:[]});
    let receipt=executor.reconcile("supervisor-death"); const deadline=Date.now()+4000;
    while(!receipt?.owner?.sealed&&Date.now()<deadline){await sleep(40);receipt=executor.reconcile("supervisor-death");}
    expect(receipt?.owner?.sealed).toBe(true);
    childIdentity=receipt?.owner?.child;
    expect(identity(receipt!.owner!.supervisor.pid)).toBe(receipt!.owner!.supervisor.start);
    process.kill(receipt!.owner!.supervisor.pid,"SIGKILL");
    const result=await pending;
    expect(result.state).toBe("unknown"); expect(result.owner?.reaped).toBe(false);
    expect(executor.reconcile("supervisor-death")?.state).toBe("unknown");
    expect(identity(childIdentity!.pid)).toBe(childIdentity!.start);
    await expect(executor.close()).rejects.toThrow("still alive");
    restarted = new SkillScriptExecutor({bunPath,bunSha256:sha(readFileSync(bunPath)),home:root});
    expect(restarted.capabilities().recoveryRequired).toBe(true);
    expect(restarted.capabilities().supported).toBe(false);
    await expect(restarted.execute({scope,operationId:"should-not-dispatch",entryRelativePath:"scripts/run.mjs",resources:resource("console.log('bad')"),readRoots:[],writeRoots:[]})).rejects.toThrow("requires recovery");
    await expect(restarted.close()).rejects.toThrow("still alive");
  } finally {
    // Fixture recovery only: never signal a recycled PID. Receipt stays unknown; no reap claim.
    if(childIdentity&&identity(childIdentity.pid)===childIdentity.start)process.kill(childIdentity.pid,"SIGKILL");
    await sleep(40); await executor.close();
    await restarted?.close();
    expect(restarted?.capabilities().recoveryRequired).toBe(false);
    expect(restarted?.reconcile("supervisor-death")?.state).toBe("unknown");
    const unlock=(path:string)=>{if(fs.lstatSync(path).isDirectory()){fs.chmodSync(path,0o700);for(const n of fs.readdirSync(path))unlock(join(path,n));}};
    unlock(root);rmSync(root,{recursive:true,force:true});proc.close();
  }
},8000);


test.skipIf(process.platform !== "darwin")("restart holds missing retained owner receipts without granting or replaying", async () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"nekodex-script-missing-owner-")));
  const base=join(root,"skill-script-runs"); mkdirSync(base,{mode:0o700}); mkdirSync(join(base,sha("missing")),{mode:0o700});
  const bunPath=realpathSync(process.execPath);
  const executor=new SkillScriptExecutor({bunPath,bunSha256:sha(readFileSync(bunPath)),home:root});
  try {
    expect(executor.capabilities().recoveryRequired).toBe(true);
    expect(executor.capabilities().supported).toBe(false);
    await expect(executor.close()).rejects.toThrow("ownership unresolved");
  } finally { rmSync(root,{recursive:true,force:true}); }
});
