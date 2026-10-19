import { PYTHON_BUILD_CREDENTIAL_POLICY } from '../../launcher/electron/python-build-source-policy.cjs';

/** The same known-name policy is used by main tree snapshots and core reviews.
 * Archives are explicitly selected raw artifacts; their effective member paths
 * are checked in the offline guest before extraction and backend execution. */
export const PYTHON_BUILD_SOURCE_PATH_GUARD = String.raw`credential_names = set(${JSON.stringify(PYTHON_BUILD_CREDENTIAL_POLICY.names)})
credential_patterns = ${JSON.stringify(PYTHON_BUILD_CREDENTIAL_POLICY.patterns)}
def checked_path(name, source=False):
    p = pathlib.PurePosixPath(name)
    assert name and not p.is_absolute() and all(s not in ('', '.', '..') for s in name.rstrip('/').split('/'))
    if source:
        assert not any(part.lower() in credential_names or any(re.search(pattern, part, re.IGNORECASE) for pattern in credential_patterns) for part in p.parts)
    return p
`;

/** Executed only by the admitted offline Linux VM. Selected build backends are
 * arbitrary code; the VM owner, not this Python process, supplies containment. */
export const PYTHON_BUILD_GUEST = String.raw`import gzip, hashlib, importlib, io, json, os, pathlib, platform, re, shutil, sys, sysconfig, tarfile, tomllib, zipfile
base = pathlib.Path.cwd()
plan = json.loads((base / 'python-build/plan.json').read_text())
assert platform.system() == 'Linux' and platform.machine() == 'aarch64'
assert platform.python_version() == '3.14.8' and sysconfig.get_config_var('EXT_SUFFIX') == '.cpython-314-aarch64-linux-musl.so'
assert os.getuid() != 0
os.environ.clear()
os.environ.update(PATH='/usr/bin:/bin', HOME=str(base), TMPDIR=str(base), LANG='C', LC_ALL='C', SOURCE_DATE_EPOCH='0', PYTHONNOUSERSITE='1', PIP_NO_INDEX='1', PIP_DISABLE_PIP_VERSION_CHECK='1')
${PYTHON_BUILD_SOURCE_PATH_GUARD}

def unpack(archive, target, kind):
    target.mkdir()
    seen, total = set(), 0
    if kind == 'zip':
        with zipfile.ZipFile(archive) as z:
            rows = z.infolist()
            assert len(rows) <= 4096
            for r in rows:
                p = checked_path(r.filename, source=True)
                key = str(p).lower()
                assert key not in seen
                seen.add(key)
                mode = r.external_attr >> 16
                assert (mode & 0o170000) in (0, 0o100000, 0o040000)
                total += r.file_size
                assert total <= 64 * 1024 * 1024 and r.file_size <= 16 * 1024 * 1024
                out = target / p
                if r.is_dir(): out.mkdir(parents=True, exist_ok=True)
                else:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(r) as f, out.open('xb') as o:
                        data = f.read(16 * 1024 * 1024 + 1)
                        assert len(data) == r.file_size
                        o.write(data)
    else:
        with gzip.open(archive, 'rb') as compressed:
            expanded = compressed.read(64 * 1024 * 1024 + 1)
        assert len(expanded) <= 64 * 1024 * 1024
        with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as t:
            count = 0
            for r in t:
                count += 1
                assert count <= 4096 and (r.isfile() or r.isdir()) and not r.sparse
                p = checked_path(r.name, source=True)
                key = str(p).lower()
                assert key not in seen
                seen.add(key)
                total += r.size
                assert total <= 64 * 1024 * 1024 and r.size <= 16 * 1024 * 1024
                out = target / p
                if r.isdir(): out.mkdir(parents=True, exist_ok=True)
                else:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    with t.extractfile(r) as f, out.open('xb') as o:
                        data = f.read(16 * 1024 * 1024 + 1)
                        assert len(data) == r.size
                        o.write(data)
    roots = list(target.iterdir())
    assert len(roots) == 1 and roots[0].is_dir()
    return roots[0]
source = base / 'python-build/source'
if plan['sourceKind'] != 'tree': source = unpack(base / 'python-build/source.archive', source, plan['sourceKind'])
deps = base / 'python-build/dependencies'
deps.mkdir()
for i, pin in enumerate(plan['buildWheels']):
    archive = base / ('python-build/wheel-' + str(i) + '.whl')
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == pin['artifactSha256']
    with zipfile.ZipFile(archive) as z:
        for r in z.infolist():
            p = checked_path(r.filename)
            if r.is_dir(): continue
            out = deps / p
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(r) as f, out.open('xb') as o: o.write(f.read())
os.chdir(source)
config = tomllib.loads((source / 'pyproject.toml').read_text())['build-system']
assert config['build-backend'] == plan['backend']
assert sorted(config['requires']) == sorted(plan['buildRequires'])
assert config.get('backend-path', []) == plan['backendPath']
sys.path[:0] = [str(source if p == '.' else source / checked_path(p)) for p in plan['backendPath']] + [str(deps)]
module, _, obj = plan['backend'].partition(':')
backend = importlib.import_module(module)
if obj:
    for part in obj.split('.'): backend = getattr(backend, part)
settings = plan['configSettings']
extra = getattr(backend, 'get_requires_for_build_wheel', lambda _: [])(settings)
assert sorted(extra) == sorted(plan['additionalBuildRequires'])
output = base / 'python-build/backend-output'
output.mkdir()
filename = backend.build_wheel(str(output), settings)
assert isinstance(filename, str) and pathlib.PurePosixPath(filename).name == filename and filename.endswith('.whl')
wheel = output / filename
assert wheel.is_file() and not wheel.is_symlink() and wheel.stat().st_size <= 16 * 1024 * 1024
# A regular fresh copy becomes a proposal; no backend-selected host paths exist.
shutil.copyfile(wheel, base / 'python-build/output.whl')
info = dict(version=1, planDigest=plan['planDigest'], filename=filename, sha256=hashlib.sha256(wheel.read_bytes()).hexdigest(), python=platform.python_version(), platform='linux_aarch64', extensionSuffix=sysconfig.get_config_var('EXT_SUFFIX'))
(base / 'python-build/output.json').write_text(json.dumps(info, sort_keys=True))
`;
