#!/usr/bin/env python3
"""Build the locked, task-owned offline ARM64 initrd; never boots a VM.
Only exact official source URLs in sources.lock.json are downloaded. No daemon,
host kernel borrowing, package hooks, guest executable or user script is run.
"""
import gzip, hashlib, io, json, os, pathlib, shutil, stat, struct, subprocess, tarfile, urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
SOURCE = REPO / 'launcher/native/execution-guest'
BUILD = SOURCE / '.build'
LOCK = json.loads((SOURCE / 'sources.lock.json').read_text())
def sha(data): return hashlib.sha256(data).hexdigest()
def artifact(key, name):
    pin = LOCK[key]; target = BUILD / 'downloads' / name
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.pending')
        with urllib.request.urlopen(pin['url'], timeout=90) as response, temporary.open('xb') as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
        if sha(temporary.read_bytes()) != pin['sha256']: raise RuntimeError('Downloaded ' + key + ' pin differs')
        temporary.rename(target)
    if sha(target.read_bytes()) != pin['sha256']: raise RuntimeError('Cached ' + key + ' pin differs')
    return target
def expand(archive, target, select=lambda name: True):
    def parents(destination):
        current = target
        for part in destination.parent.relative_to(target).parts:
            current = current / part
            if current.is_symlink(): raise RuntimeError('Archive parent symlink')
            if current.exists():
                if not current.is_dir(): raise RuntimeError('Archive parent is not directory')
            else: current.mkdir()
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            name = member.name.removeprefix('./')
            if not select(name): continue
            parts = pathlib.PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts: raise RuntimeError('Archive path escape')
            # Fixed hash-verified distro symlinks are retained as guest symlinks;
            # extraction never follows an already created link for a later file.
            destination = target / name
            if name in ('', '.'): continue
            parents(destination)
            if destination.is_symlink(): raise RuntimeError('Archive destination symlink')
            if member.isdir(): destination.mkdir(exist_ok=True); os.chmod(destination, member.mode & 0o777)
            elif member.issym(): destination.symlink_to(member.linkname)
            elif member.isreg():
                with destination.open('xb') as output: shutil.copyfileobj(source.extractfile(member), output)
                os.chmod(destination, member.mode & 0o777)  # no setuid/setgid elevation in guest
            elif member.islnk():
                linkname = pathlib.PurePosixPath(member.linkname)
                if linkname.is_absolute() or '..' in linkname.parts: raise RuntimeError('Archive hardlink escape')
                link = target / member.linkname
                parents(link)
                if not link.is_file() or link.is_symlink(): raise RuntimeError('Unexpected archive hardlink')
                with link.open('rb') as source_file, destination.open('xb') as output: shutil.copyfileobj(source_file,output)
                os.chmod(destination, member.mode & 0o777)
            else: raise RuntimeError('Unexpected special archive entry')
def newc(tree):
    result = bytearray(); inode = 1
    def entry(name, mode, data=b'', major=0, minor=0):
        nonlocal inode
        raw = name.encode() + b'\0'; values = [inode, mode, 0, 0, 2 if stat.S_ISDIR(mode) else 1, 0, len(data), 0, 0, major, minor, len(raw), 0]
        inode += 1; result.extend(b'070701' + ''.join('%08x' % x for x in values).encode()); result.extend(raw)
        result.extend(b'\0' * (-len(result) % 4)); result.extend(data); result.extend(b'\0' * (-len(result) % 4))
    for item in sorted(tree.rglob('*'), key=lambda p: p.relative_to(tree).as_posix()):
        name = item.relative_to(tree).as_posix(); info = item.lstat()
        if item.is_symlink(): entry(name, stat.S_IFLNK | 0o777, os.readlink(item).encode())
        elif item.is_dir(): entry(name, stat.S_IFDIR | stat.S_IMODE(info.st_mode))
        elif item.is_file(): entry(name, stat.S_IFREG | stat.S_IMODE(info.st_mode), item.read_bytes())
        else: raise RuntimeError('Unexpected initrd host file')
    entry('dev/console', stat.S_IFCHR | 0o600, major=5, minor=1)
    entry('dev/null', stat.S_IFCHR | 0o666, major=1, minor=3)
    entry('TRAILER!!!', 0)
    result.extend(b'\0' * (-len(result) % 512)); return bytes(result)
def main():
    if BUILD.exists() and (BUILD.is_symlink() or BUILD.resolve()!=BUILD): raise RuntimeError('Task build directory must be canonical')
    BUILD.mkdir(exist_ok=True); (BUILD / 'downloads').mkdir(exist_ok=True)
    go_archive = artifact('go', 'go.tar.gz'); rootfs = artifact('rootfs', 'rootfs.tar.gz'); kernel = artifact('kernel', 'linux-virt.apk')
    go = BUILD / 'go/bin/go'
    if go.parent.parent.exists():
        if go.parent.parent.is_symlink(): raise RuntimeError('Task toolchain must not be a symlink')
        shutil.rmtree(go.parent.parent)
    expand(go_archive, BUILD)
    for directory in ['home','tmp','gopath']: (BUILD/directory).mkdir(exist_ok=True)
    env = {'PATH':'/usr/bin:/bin','HOME':str(BUILD/'home'),'TMPDIR':str(BUILD/'tmp'),'LANG':'C','LC_ALL':'C',
        'CGO_ENABLED':'0','GOOS':'linux','GOARCH':'arm64','GOMAXPROCS':'2','GOROOT':str(BUILD/'go'),'GOPATH':str(BUILD/'gopath'),
        'GOENV':'off','GOWORK':'off','GOFLAGS':'','GOTOOLCHAIN':'local','GOPROXY':'off','GOSUMDB':'off','GOCACHE':str(BUILD/'go-cache')}
    snapshot = BUILD / 'source-snapshot'
    if snapshot.exists():
        if snapshot.is_symlink(): raise RuntimeError('Source snapshot must not be a symlink')
        os.chmod(snapshot, 0o700)
        for file in snapshot.iterdir(): os.chmod(file, 0o600)
        shutil.rmtree(snapshot)
    snapshot.mkdir()
    source_bytes = {p.name:p.read_bytes() for p in SOURCE.glob('*.go') if not p.name.endswith('_test.go')}
    source_bytes['go.mod'] = (SOURCE/'go.mod').read_bytes(); source_bytes['init'] = (SOURCE/'init').read_bytes()
    for name,data in source_bytes.items(): (snapshot/name).write_bytes(data); os.chmod(snapshot/name,0o400)
    os.chmod(snapshot,0o500)
    subprocess.run([str(go), 'build', '-p=2', '-buildvcs=false', '-trimpath', '-ldflags=-s -w -buildid=', '-o', str(BUILD / 'neko-guest-agent'), '.'], cwd=snapshot, env=env, check=True)
    tree = BUILD / 'rootfs'
    if tree.exists(): shutil.rmtree(tree)
    tree.mkdir(); expand(rootfs, tree)
    # Extract only the vsock/console transport dependency closure. Full Linux
    # module trees have case-distinct names that cannot coexist on common macOS filesystems.
    with tarfile.open(kernel,'r:gz') as archive:
        depname = next(name for name in archive.getnames() if name.endswith('/modules.dep'))
        modulebase = depname.rsplit('/',1)[0]
        dependencies = dict(line.split(':',1) for line in archive.extractfile(depname).read().decode().splitlines())
        wanted = set()
        def add(name):
            if name in wanted:return
            wanted.add(name)
            for dependency in dependencies[name].split():add(dependency)
        for module in ['virtio_pci','virtio_mmio','virtio_console','vmw_vsock_virtio_transport']:
            for name in dependencies:
                if name.rsplit('/',1)[-1].split('.ko')[0].replace('-','_') == module:add(name)
    expand(kernel,tree,lambda name:name in {modulebase+'/'+module for module in wanted} or name in [modulebase+'/modules.builtin',modulebase+'/modules.builtin.modinfo'])
    # BusyBox modprobe cannot be assumed to decode the kernel package's gzip
    # modules. Retain exact decompressed/signed ELF bytes and rewrite every
    # dependency edge to the corresponding plain .ko filename.
    plain_modules={}
    for name in sorted(wanted):
        source=tree/modulebase/name
        if not name.endswith('.ko.gz'): raise RuntimeError('Unexpected pinned module compression')
        data=gzip.decompress(source.read_bytes())
        if data[:4]!=b'\x7fELF' or data[4:6]!=b'\x02\x01' or struct.unpack_from('<H',data,18)[0]!=183: raise RuntimeError('Pinned module is not a Linux ARM64 ELF')
        plain=name[:-3];(tree/modulebase/plain).write_bytes(data);os.chmod(tree/modulebase/plain,0o644);source.unlink();plain_modules[name]=plain
    (tree/modulebase/'modules.dep').write_text(''.join(plain_modules[name]+':'+''.join(' '+plain_modules[dep] for dep in dependencies[name].split())+'\n' for name in sorted(wanted)))
    (tree / 'workspace').mkdir(mode=0o700, exist_ok=True)
    (tree / 'usr/local/bin').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BUILD / 'neko-guest-agent', tree / 'usr/local/bin/neko-guest-agent'); os.chmod(tree / 'usr/local/bin/neko-guest-agent', 0o755)
    (tree/'init').write_bytes(source_bytes['init']); os.chmod(tree / 'init', 0o755)
    with tarfile.open(kernel, 'r:gz') as archive: image = archive.extractfile('boot/vmlinuz-virt').read(); config = archive.extractfile('boot/config-6.18.57-0-virt').read()
    if image[4:8] == b'zimg':
        # Linux's documented EFI zboot header locates the gzip payload; Apple VZ
        # receives its decompressed ARM64 Image, not the PE/EFI executable wrapper.
        offset,size=struct.unpack_from('<II',image,8)
        if image[24:29] != b'gzip\0' or offset<64 or not size or offset+size>len(image): raise RuntimeError('Unsupported EFI zboot payload')
        image=gzip.decompress(image[offset:offset+size])
    elif image[:2] == b'\x1f\x8b': image = gzip.decompress(image)
    if len(image) < 64 or image[56:60] != b'ARM\x64': raise RuntimeError('Pinned kernel is not a raw Linux ARM64 Image')
    if b'CONFIG_VIRTIO_VSOCKETS=m' not in config and b'CONFIG_VIRTIO_VSOCKETS=y' not in config: raise RuntimeError('Kernel lacks vsock')
    bundle = BUILD / 'bundle'
    if bundle.is_symlink(): raise RuntimeError('Bundle directory must not be a symlink')
    bundle.mkdir(exist_ok=True)
    (bundle / 'Image').write_bytes(image)
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0, filename='') as compressed: compressed.write(newc(tree))
    (bundle / 'initrd.gz').write_bytes(buffer.getvalue())
    (bundle / 'kernel.config').write_bytes(config)
    (bundle / 'alpine-installed-packages.txt').write_bytes((tree / 'lib/apk/db/installed').read_bytes())
    packages=[]
    for block in (tree/'lib/apk/db/installed').read_text().split('\n\n'):
        fields=dict(line.split(':',1) for line in block.splitlines() if len(line)>1 and line[1]==':')
        if 'P' in fields: packages.append({'name':fields['P'],'version':fields.get('V'),'license':fields.get('L'),'origin':fields.get('o'),'sourceCommit':fields.get('c')})
    (bundle/'alpine-package-provenance.json').write_text(json.dumps(packages,indent=2,sort_keys=True)+'\n')
    sources = {name:sha(data) for name,data in source_bytes.items()}
    manifest = {'version':1, 'protocol':'neko-vm-v1', 'architecture':'arm64',
        'kernel':{'path':str((bundle/'Image').resolve()), 'sha256':sha(image)},
        'initrd':{'path':str((bundle/'initrd.gz').resolve()), 'sha256':sha(buffer.getvalue())},
        'agentSha256':sha((BUILD/'neko-guest-agent').read_bytes()), 'sourceSha256':sources,
        'kernelModules':sorted(plain_modules.values()),
        'provenance':[{'component':key, **pin} for key,pin in LOCK.items() if isinstance(pin,dict)],
        'tools':['/bin/sh (BusyBox ash)','BusyBox external applets/pipelines/subshell/fork/setsid','neko-guest-agent v1'],
        'limitations':['offline; no NIC or host shares','no compiler/Python toolchain included; native compilation remains open','guest outputs are untrusted proposals; physical stop and separately approved export are host-owned'],
        'build':{'go':'1.26.3','CGO_ENABLED':'0','GOOS':'linux','GOARCH':'arm64','trimpath':True,'buildvcs':False,'sourceDateEpoch':0},
        'licenses':{'kernel':'GPL-2.0-only','busybox':'GPL-2.0-only','musl':'MIT','go':'BSD-3-Clause','packageInventory':'alpine-installed-packages.txt'}}
    (bundle/'manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'manifest':str(bundle/'manifest.json'),'manifestSha256':sha((bundle/'manifest.json').read_bytes()),'kernel':manifest['kernel'],'initrd':manifest['initrd'],'agentSha256':manifest['agentSha256']}))
if __name__ == '__main__': main()
