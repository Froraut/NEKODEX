#!/usr/bin/env python3
"""Build the locked, task-owned offline ARM64 initrd; never boots a VM.
Only exact official source URLs in sources.lock.json are downloaded. No daemon,
host kernel borrowing, package hooks, guest executable or user script is run.
"""
import argparse, gzip, hashlib, io, json, os, pathlib, re, shutil, stat, struct, subprocess, tarfile, urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
SOURCE = REPO / 'launcher/native/execution-guest'
BUILD = SOURCE / '.build'
LOCK = json.loads((SOURCE / 'sources.lock.json').read_text())
def sha(data): return hashlib.sha256(data).hexdigest()
def artifact(key, name, pin=None):
    pin = LOCK[key] if pin is None else pin; target = BUILD / 'downloads' / name
    if target.is_symlink(): raise RuntimeError('Download cache symlink')
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.pending')
        with urllib.request.urlopen(pin['url'], timeout=90) as response, temporary.open('xb') as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
        if sha(temporary.read_bytes()) != pin['sha256']: raise RuntimeError('Downloaded ' + key + ' pin differs')
        temporary.rename(target)
    if sha(target.read_bytes()) != pin['sha256']: raise RuntimeError('Cached ' + key + ' pin differs')
    return target
def expand(archive, target, select=lambda name: True, replacements=None):
    replacements = replacements or {}
    seen = set()
    # Also reject case aliases when staging on the usual case-insensitive Mac FS.
    existing = {p.relative_to(target).as_posix().casefold():p.relative_to(target).as_posix() for p in target.rglob('*')}
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
            parts = pathlib.PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts: raise RuntimeError('Archive path escape')
            if not select(name): continue
            if name in seen: raise RuntimeError('Duplicate archive path: ' + name)
            seen.add(name)
            alias = existing.get(name.casefold())
            if alias is not None and alias != name: raise RuntimeError('Archive case alias: ' + name)
            existing[name.casefold()] = name
            # Fixed hash-verified distro symlinks are retained as guest symlinks;
            # extraction never follows an already created link for a later file.
            destination = target / name
            if name in ('', '.'): continue
            parents(destination)
            if destination.is_symlink():
                expected = replacements.get(name)
                if expected is None or os.readlink(destination) != expected or not member.isreg():
                    raise RuntimeError('Archive destination symlink: ' + name)
                destination.unlink()
            if member.isdir():
                if destination.exists() and not destination.is_dir(): raise RuntimeError('Archive directory collision: ' + name)
                destination.mkdir(exist_ok=True)
                os.chmod(destination, member.mode & 0o1777)
            elif member.issym():
                if destination.exists(): raise RuntimeError('Archive symlink collision: ' + name)
                if '\x00' in member.linkname: raise RuntimeError('Invalid guest symlink')
                destination.symlink_to(member.linkname)
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
# APK v2 root control entries are metadata, never guest payloads or hooks.
APK_CONTROL = {'.PKGINFO', '.pre-install', '.post-install', '.pre-upgrade', '.post-upgrade', '.pre-deinstall', '.post-deinstall', '.trigger'}

def package_inventory(text):
    packages = []
    for block in text.split('\n\n'):
        fields = dict(line.split(':', 1) for line in block.splitlines() if len(line) > 1 and line[1] == ':')
        if 'P' in fields:
            packages.append({'name':fields['P'], 'version':fields.get('V'), 'license':fields.get('L'), 'origin':fields.get('o'), 'sourceCommit':fields.get('c')})
    return packages

def validate_profile():
    profile = LOCK['developmentProfile']
    pins = profile['packages']
    names = {p['name']:p for p in pins}
    if len(names) != len(pins) or profile['roots'] != ['gcc','musl-dev','python3','python3-dev','make']:
        raise RuntimeError('Unexpected development profile roots or duplicate package')
    providers = {}
    for pin in pins:
        if pin['architecture'] != 'aarch64' or not re.fullmatch('[0-9a-f]{40}', pin['sourceCommit']):
            raise RuntimeError('Invalid package architecture/source commit')
        if pin['extractPayload']:
            if pin['payloadArchitecture'] not in ('aarch64','noarch'): raise RuntimeError('Unsupported APK payload architecture')
            expected = 'https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/' + pin['name'] + '-' + pin['version'] + '.apk'
            if pin['url'] != expected or not re.fullmatch('[0-9a-f]{64}', pin['sha256']):
                raise RuntimeError('Invalid official package pin')
        for provide in [pin['name']+'='+pin['version']] + pin['provides']:
            name, _, version = provide.partition('=')
            providers.setdefault(name, []).append((pin['name'], version))
    reached = set()
    def visit(name):
        if name in reached: return
        reached.add(name)
        for dependency in names[name]['dependencies']:
            match = re.fullmatch(r'([^<>=~!]+)(?:(>=|=)([^<>=~!]+))?', dependency)
            if not match: raise RuntimeError('Unsupported fixed-profile dependency: ' + dependency)
            key, relation, wanted = match.groups()
            choices = providers.get(key, [])
            selected = key if key in names else profile['providerChoice'].get(key)
            if selected: choices = [p for p in choices if p[0] == selected]
            if len(choices) != 1: raise RuntimeError('Ambiguous/missing dependency: ' + dependency)
            resolved, actual = choices[0]
            if relation == '=' and actual != wanted: raise RuntimeError('Exact dependency mismatch: ' + dependency)
            if relation == '>=':
                # Only the two numeric minimum constraints in this fixed profile.
                if not re.fullmatch(r'[0-9.]+', wanted) or not re.fullmatch(r'[0-9.]+-r[0-9]+', actual):
                    raise RuntimeError('Unsupported fixed-profile version comparison')
                if tuple(map(int,actual.split('-r')[0].split('.'))) < tuple(map(int,wanted.split('.'))):
                    raise RuntimeError('Minimum dependency mismatch: ' + dependency)
            visit(resolved)
    for name in profile['roots']: visit(name)
    if reached != set(names): raise RuntimeError('Unreachable package in fixed development closure')

def verify_package(archive, pin):
    with tarfile.open(archive, 'r:gz') as source:
        members = [m for m in source if m.name == '.PKGINFO']
        if len(members) != 1 or not members[0].isreg(): raise RuntimeError('Missing/duplicate APK metadata')
        fields = {}
        for line in source.extractfile(members[0]).read().decode().splitlines():
            if ' = ' in line:
                key, value = line.split(' = ', 1)
                fields.setdefault(key, []).append(value)
        for field, key in [('pkgname','name'),('pkgver','version'),('arch','payloadArchitecture'),('license','license'),('origin','origin'),('commit','sourceCommit')]:
            if fields.get(field) != [pin[key]]: raise RuntimeError('APK metadata differs: ' + pin['name'] + '/' + field)
        if sorted(fields.get('depend', [])) != sorted(pin['dependencies']) or sorted(fields.get('provides', [])) != sorted(pin['provides']):
            raise RuntimeError('APK dependency/provides metadata differs: ' + pin['name'])

def tree_digest(tree):
    digest = hashlib.sha256()
    for path in sorted(tree.rglob('*'), key=lambda p:p.relative_to(tree).as_posix()):
        info = path.lstat()
        digest.update(json.dumps([path.relative_to(tree).as_posix(),info.st_mode],separators=(',',':')).encode()+b'\0')
        if path.is_symlink(): digest.update(os.readlink(path).encode())
        elif path.is_file():
            with path.open('rb') as file:
                while chunk := file.read(1024*1024): digest.update(chunk)
        elif not path.is_dir(): raise RuntimeError('Special cached toolchain entry')
        digest.update(b'\0')
    return digest.hexdigest()

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
    global BUILD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-dir', type=pathlib.Path, default=BUILD, help='Separate task-owned staging directory; never boots or publishes a VM')
    args = parser.parse_args()
    BUILD = args.build_dir.absolute()
    validate_profile()
    if BUILD.exists() and (BUILD.is_symlink() or BUILD.resolve()!=BUILD): raise RuntimeError('Task build directory must be canonical')
    BUILD.mkdir(exist_ok=True)
    if (BUILD/'downloads').is_symlink(): raise RuntimeError('Download directory symlink')
    (BUILD / 'downloads').mkdir(exist_ok=True)
    go_archive = artifact('go', 'go.tar.gz'); rootfs = artifact('rootfs', 'rootfs.tar.gz'); kernel = artifact('kernel', 'linux-virt.apk')
    go = BUILD / 'go/bin/go'
    # Reuse only a fully verified immutable extracted host toolchain. The stamp
    # binds its complete path/type/mode/content tree to the exact archive pin.
    stamp = BUILD/'go-toolchain.json'
    if go.parent.parent.exists():
        if go.parent.parent.is_symlink(): raise RuntimeError('Task toolchain must not be a symlink')
        if stamp.exists():
            if stamp.is_symlink() or json.loads(stamp.read_text()) != {'archiveSha256':LOCK['go']['sha256'],'treeSha256':tree_digest(go.parent.parent)}:
                raise RuntimeError('Cached host toolchain changed')
        else:
            shutil.rmtree(go.parent.parent)
            expand(go_archive, BUILD)
            stamp.write_text(json.dumps({'archiveSha256':LOCK['go']['sha256'],'treeSha256':tree_digest(go.parent.parent)},sort_keys=True)+'\n')
    else:
        if stamp.exists() or stamp.is_symlink(): raise RuntimeError('Toolchain stamp without toolchain')
        expand(go_archive, BUILD)
        stamp.write_text(json.dumps({'archiveSha256':LOCK['go']['sha256'],'treeSha256':tree_digest(go.parent.parent)},sort_keys=True)+'\n')
    for directory in ['home','tmp','gopath']: (BUILD/directory).mkdir(exist_ok=True)
    env = {'PATH':'/usr/bin:/bin','HOME':str(BUILD/'home'),'TMPDIR':str(BUILD/'tmp'),'LANG':'C','LC_ALL':'C',
        'CGO_ENABLED':'0','GOOS':'linux','GOARCH':'arm64','GOMAXPROCS':'2','GOROOT':str(BUILD/'go'),'GOPATH':str(BUILD/'gopath'),
        'GOENV':'off','GOWORK':'off','GOFLAGS':'','GOTOOLCHAIN':'local','GOPROXY':'off','GOSUMDB':'off','GOCACHE':str(BUILD/'go-cache')}
    snapshot = BUILD / 'source-snapshot'
    source_bytes = {p.name:p.read_bytes() for p in SOURCE.glob('*.go') if not p.name.endswith('_test.go')}
    source_bytes['go.mod'] = (SOURCE/'go.mod').read_bytes(); source_bytes['init'] = (SOURCE/'init').read_bytes()
    if snapshot.is_symlink(): raise RuntimeError('Source snapshot must not be a symlink')
    unchanged = snapshot.is_dir() and {p.name for p in snapshot.iterdir()} == set(source_bytes)
    unchanged = unchanged and all(not (snapshot/name).is_symlink() and (snapshot/name).is_file() and (snapshot/name).read_bytes() == data for name,data in source_bytes.items())
    if not unchanged:
        if snapshot.exists():
            os.chmod(snapshot, 0o700)
            for file in snapshot.iterdir():
                if file.is_symlink() or not file.is_file(): raise RuntimeError('Unexpected source snapshot entry')
                os.chmod(file, 0o600)
            shutil.rmtree(snapshot)
        snapshot.mkdir()
        for name,data in source_bytes.items(): (snapshot/name).write_bytes(data); os.chmod(snapshot/name,0o400)
        os.chmod(snapshot,0o500)
    subprocess.run([str(go), 'build', '-p=2', '-buildvcs=false', '-trimpath', '-ldflags=-s -w -buildid=', '-o', str(BUILD / 'neko-guest-agent'), '.'], cwd=snapshot, env=env, check=True)
    tree = BUILD / 'rootfs'
    if tree.is_symlink(): raise RuntimeError('Rootfs staging directory must not be a symlink')
    if tree.exists(): shutil.rmtree(tree)
    tree.mkdir(); expand(rootfs, tree)
    base_packages = package_inventory((tree/'lib/apk/db/installed').read_text())
    for package in base_packages: package['payloadState'] = 'installed in pinned minirootfs APK database'
    profile = LOCK['developmentProfile']
    for pin in profile['packages']:
        if not pin['extractPayload']:
            actual = next((p for p in base_packages if p['name'] == pin['name']), None)
            if actual is None or any(actual[k] != pin[k] for k in ['version','license','origin','sourceCommit']):
                raise RuntimeError('Base package differs from profile: ' + pin['name'])
            continue
        archive = artifact(pin['name'], pin['name']+'-'+pin['version']+'.apk', pin)
        verify_package(archive, pin)
        replacements = {name:rule['previousSymlink'] for name,rule in profile['replacements'].items() if rule['package'] == pin['name']}
        expand(archive, tree, lambda name: name not in APK_CONTROL and not name.startswith('.SIGN.'), replacements)
    # No APK hooks or triggers run on host or guest. Keep the actual base APK DB
    # intact: extracted development payloads have a separate truthful inventory.
    development_packages = [pin for pin in profile['packages'] if pin['extractPayload']]
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
    packages = base_packages + development_packages
    (bundle/'development-package-provenance.json').write_text(json.dumps(profile,indent=2,sort_keys=True)+'\n')
    (bundle/'alpine-package-provenance.json').write_text(json.dumps(packages,indent=2,sort_keys=True)+'\n')
    sources = {name:sha(data) for name,data in source_bytes.items()}
    versions = {p['name']:p['version'] for p in profile['packages']}
    manifest = {'version':1, 'protocol':'neko-vm-v1', 'architecture':'arm64',
        'kernel':{'path':str((bundle/'Image').resolve()), 'sha256':sha(image)},
        'initrd':{'path':str((bundle/'initrd.gz').resolve()), 'sha256':sha(buffer.getvalue())},
        'agentSha256':sha((BUILD/'neko-guest-agent').read_bytes()), 'sourceSha256':sources,
        'kernelModules':sorted(plain_modules.values()),
        'provenance':[{'component':key, **pin} for key,pin in LOCK.items() if isinstance(pin,dict)],
        'developmentProfile':{'name':profile['name'],'versions':versions,'packageInventory':'development-package-provenance.json','hooksExecuted':False,'apkDatabase':'base minirootfs only; additional extracted payloads in development inventory'},
        'tools':['/bin/sh (BusyBox ash)','BusyBox external applets/pipelines/subshell/fork/setsid','neko-guest-agent v1',
            'gcc '+versions['gcc']+' (Linux aarch64 musl)','Python '+versions['python3']+' with ctypes and development headers',
            'GNU make '+versions['make'],'pkgconf '+versions['pkgconf']],
        'limitations':['offline; no NIC or host shares','fixed Linux ARM64 development profile only; Darwin ABI/frameworks, network grants and production/installed runtime remain open','no pip/setuptools or downloaded dependencies; package hooks and bytecode/ldconfig triggers are not executed','guest outputs are untrusted proposals; physical stop and separately approved export are host-owned'],
        'build':{'go':'1.26.3','CGO_ENABLED':'0','GOOS':'linux','GOARCH':'arm64','trimpath':True,'buildvcs':False,'sourceDateEpoch':0},
        'licenses':{'kernel':'GPL-2.0-only','busybox':'GPL-2.0-only','musl':'MIT','go':'BSD-3-Clause','packageInventory':'alpine-package-provenance.json'}}
    (bundle/'manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'manifest':str(bundle/'manifest.json'),'manifestSha256':sha((bundle/'manifest.json').read_bytes()),'kernel':manifest['kernel'],'initrd':manifest['initrd'],'agentSha256':manifest['agentSha256']}))
if __name__ == '__main__': main()
