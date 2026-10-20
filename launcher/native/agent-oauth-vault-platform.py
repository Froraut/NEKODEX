#!/usr/bin/env python3
"""Protected OAuth helper source for Windows/Linux; package as the fixed helper.

No generic keyring selection, plaintext fallback, unlock prompt or token argv.
Windows: current-user Credential Manager + SID-DACL global mutex; 2560-byte blob.
Linux: SecretStorage 3.5.0 encrypted session + existing durable default collection;
private XDG_RUNTIME_DIR flock serializes cooperating helpers across processes.
The OS vault owns durable data; lock files contain no credentials. These adapters
are source-only until target-OS packaging and real protected-backend verification.
"""
import contextlib
import json
import math
import os
import re
import stat
import sys

LIMIT = 32768
SERVICE = 'dev.nekodex.mcp-oauth.v1'
HASH = re.compile(r'[a-f0-9]{64}\Z')
REVISION = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z')
TOKEN = re.compile(r'[\x21-\x7e]{1,8192}\Z')

class VaultError(Exception):
    pass

def fail(code):
    raise VaultError(code)

def valid_entry(item, scope):
    if not isinstance(item, dict) or set(item) != {'scopeHash', 'revision', 'record'} or item['scopeHash'] != scope:
        return False
    if not isinstance(item['revision'], str) or not REVISION.fullmatch(item['revision']):
        return False
    record = item['record']
    if not isinstance(record, dict) or set(record) not in ({'phase', 'accessToken', 'expiresAt'}, {'phase', 'accessToken', 'refreshToken', 'expiresAt'}):
        return False
    return (record['phase'] in ('ready', 'refresh_pending', 'revocation_pending')
            and isinstance(record['accessToken'], str) and TOKEN.fullmatch(record['accessToken'])
            and ('refreshToken' not in record or isinstance(record['refreshToken'], str) and TOKEN.fullmatch(record['refreshToken']))
            and type(record['expiresAt']) in (int, float) and math.isfinite(record['expiresAt']) and record['expiresAt'] >= 0)

def decode_entry(data, scope):
    if len(data) > LIMIT:
        fail('corrupt')
    try:
        item = json.loads(data)
    except (ValueError, UnicodeError):
        fail('corrupt')
    if not valid_entry(item, scope):
        fail('corrupt')
    return item

class WindowsVault:
    def __init__(self, scope):
        import ctypes as c
        from ctypes import wintypes as w
        self.c, self.w, self.target = c, w, SERVICE + ':' + scope
        self.advapi = c.WinDLL('advapi32', use_last_error=True)
        self.kernel = c.WinDLL('kernel32', use_last_error=True)
        class CREDENTIAL(c.Structure):
            _fields_ = [('Flags', w.DWORD), ('Type', w.DWORD), ('TargetName', w.LPWSTR), ('Comment', w.LPWSTR),
                        ('LastWritten', w.FILETIME), ('CredentialBlobSize', w.DWORD), ('CredentialBlob', c.POINTER(c.c_ubyte)),
                        ('Persist', w.DWORD), ('AttributeCount', w.DWORD), ('Attributes', c.c_void_p),
                        ('TargetAlias', w.LPWSTR), ('UserName', w.LPWSTR)]
        self.Credential = CREDENTIAL
        self.advapi.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.POINTER(c.POINTER(CREDENTIAL))]
        self.advapi.CredReadW.restype = w.BOOL
        self.advapi.CredWriteW.argtypes = [c.POINTER(CREDENTIAL), w.DWORD]
        self.advapi.CredWriteW.restype = w.BOOL
        self.advapi.CredDeleteW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD]
        self.advapi.CredDeleteW.restype = w.BOOL
        self.advapi.CredFree.argtypes = [c.c_void_p]
        self.kernel.GetCurrentProcess.restype = w.HANDLE
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.kernel.LocalFree.argtypes = [c.c_void_p]
        self.kernel.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        self.kernel.ReleaseMutex.argtypes = [w.HANDLE]
        self.kernel.CreateMutexW.restype = w.HANDLE
        self.kernel.CreateMutexW.argtypes = [c.c_void_p, w.BOOL, w.LPCWSTR]
        self.advapi.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
        self.advapi.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
        self.advapi.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
        self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(c.c_void_p), c.POINTER(w.DWORD)]

    def read(self):
        pointer = self.c.POINTER(self.Credential)()
        if not self.advapi.CredReadW(self.target, 1, 0, self.c.byref(pointer)):
            if self.c.get_last_error() == 1168:
                return None
            fail('unavailable')
        try:
            credential = pointer.contents
            if credential.Type != 1 or credential.TargetName != self.target or credential.CredentialBlobSize > 2560:
                fail('corrupt')
            return self.c.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        finally:
            self.advapi.CredFree(pointer)

    def write(self, data):
        if len(data) > 2560:
            fail('unsupported')  # Native Credential Manager blob limit; never split a CAS record.
        buffer = (self.c.c_ubyte * len(data)).from_buffer_copy(data)
        credential = self.Credential()
        credential.Type, credential.TargetName, credential.Persist = 1, self.target, 2
        credential.CredentialBlobSize, credential.CredentialBlob = len(data), buffer
        credential.UserName = SERVICE
        if not self.advapi.CredWriteW(self.c.byref(credential), 0):
            fail('unavailable')

    def remove(self):
        if not self.advapi.CredDeleteW(self.target, 1, 0):
            fail('unavailable')

    @contextlib.contextmanager
    def transaction(self, scope):
        c, w = self.c, self.w
        token, text, descriptor = w.HANDLE(), w.LPWSTR(), c.c_void_p()
        mutex = None
        try:
            if not self.advapi.OpenProcessToken(self.kernel.GetCurrentProcess(), 8, c.byref(token)):
                fail('unavailable')
            size = w.DWORD()
            self.advapi.GetTokenInformation(token, 1, None, 0, c.byref(size))
            buffer = c.create_string_buffer(size.value)
            if not self.advapi.GetTokenInformation(token, 1, buffer, size.value, c.byref(size)):
                fail('unavailable')
            sid = c.cast(buffer, c.POINTER(c.c_void_p))[0]
            if not self.advapi.ConvertSidToStringSidW(sid, c.byref(text)):
                fail('unavailable')
            sid_text = text.value
            if not self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW('D:P(A;;GA;;;' + sid_text + ')', 1, c.byref(descriptor), None):
                fail('unavailable')
            class ATTRIBUTES(c.Structure):
                _fields_ = [('length', w.DWORD), ('descriptor', c.c_void_p), ('inherit', w.BOOL)]
            attributes = ATTRIBUTES(c.sizeof(ATTRIBUTES), descriptor, False)
            mutex = self.kernel.CreateMutexW(c.byref(attributes), False, 'Global\\NEKODEX.OAuth.' + sid_text + '.' + scope)
            if not mutex:
                fail('unavailable')
            # Abandoned ownership still requires read/reconcile; no operation is replayed here.
            if self.kernel.WaitForSingleObject(mutex, 5000) not in (0, 0x80):
                fail('unavailable')
            try:
                yield
            finally:
                self.kernel.ReleaseMutex(mutex)
        finally:
            if mutex:
                self.kernel.CloseHandle(mutex)
            if descriptor:
                self.kernel.LocalFree(descriptor)
            if text:
                self.kernel.LocalFree(c.cast(text, c.c_void_p))
            if token:
                self.kernel.CloseHandle(token)

class LinuxVault:
    def __init__(self, scope):
        # Fixed protected backend; never keyring.get_keyring()/session collection.
        import secretstorage
        from secretstorage.util import open_session
        self.connection = secretstorage.dbus_init()
        self.session = open_session(self.connection)
        if self.session.encrypted is not True:
            fail('unsupported')
        self.collection = secretstorage.Collection(self.connection, session=self.session)
        if self.collection.is_locked():
            fail('locked')
        # Default alias must resolve to a persistent collection, not session memory.
        from secretstorage.collection import get_collection_by_alias, SESSION_COLLECTION
        resolved = get_collection_by_alias(self.connection, 'default')
        if resolved.collection_path == SESSION_COLLECTION or resolved.collection_path.endswith('/session'):
            fail('unsupported')
        self.attributes = {'application': SERVICE, 'scope': scope}
        self.item = None

    def read(self):
        items = list(self.collection.search_items(self.attributes))
        if len(items) > 1:
            fail('corrupt')
        self.item = items[0] if items else None
        if self.item and self.item.is_locked():
            fail('locked')
        return self.item.get_secret() if self.item else None

    def write(self, data):
        if self.item:
            self.item.set_secret(data, 'application/json')
            return
        # Do not execute prompts, including a provider's unusual CreateItem prompt.
        from secretstorage.util import format_secret
        from secretstorage.defines import SS_PREFIX
        properties = {SS_PREFIX + 'Item.Label': ('s', 'NEKODEX protected MCP OAuth credential'),
                      SS_PREFIX + 'Item.Attributes': ('a{ss}', self.attributes)}
        item_path, prompt = self.collection._collection.call('CreateItem', 'a{sv}(oayays)b', properties,
            format_secret(self.session, data, 'application/json'), False)
        if prompt != '/' or item_path == '/':
            fail('locked')

    def remove(self):
        prompt, = self.item._item.call('Delete', '')
        if prompt != '/':
            fail('locked')

    @contextlib.contextmanager
    def transaction(self, scope):
        import fcntl
        runtime = os.environ.get('XDG_RUNTIME_DIR', '/run/user/' + str(os.getuid()))
        directory = os.open(runtime, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(directory)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
                fail('unavailable')
            lock = os.open('nekodex-oauth-' + scope + '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                info = os.fstat(lock)
                if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077 or info.st_nlink != 1:
                    fail('unavailable')
                fcntl.flock(lock, fcntl.LOCK_EX)
                yield
            finally:
                os.close(lock)
        finally:
            os.close(directory)


def perform(request):
    if not isinstance(request, dict) or request.get('version') != 1 or type(request.get('version')) is not int:
        fail('invalid-input')
    scope, operation = request.get('scopeHash'), request.get('operation')
    if not isinstance(scope, str) or not HASH.fullmatch(scope):
        fail('invalid-input')
    keys = {'version', 'operation', 'scopeHash'}
    if operation == 'compare-and-set':
        keys |= {'expectedRevision', 'entry'}
        if not valid_entry(request.get('entry'), scope):
            fail('invalid-input')
    elif operation == 'remove':
        keys.add('expectedRevision')
    elif operation != 'read':
        fail('unsupported')
    if set(request) != keys:
        fail('invalid-input')
    expected = request.get('expectedRevision')
    if operation != 'read' and not (operation == 'compare-and-set' and expected is None):
        if not isinstance(expected, str) or not REVISION.fullmatch(expected):
            fail('invalid-input')
    if sys.platform == 'win32':
        vault = WindowsVault(scope)
    elif sys.platform == 'linux':
        vault = LinuxVault(scope)
    else:
        fail('unsupported')
    with vault.transaction(scope):
        data = vault.read()
        stored = decode_entry(data, scope) if data is not None else None
        if operation == 'read':
            return {'status': 'ok', 'entry': stored} if stored else {'status': 'not-found'}
        if (stored['revision'] if stored else None) != expected:
            fail('conflict')
        if operation == 'remove':
            vault.remove()
            return {'status': 'ok', 'removed': True}
        encoded = json.dumps(request['entry'], separators=(',', ':'), ensure_ascii=True).encode('ascii')
        if len(encoded) > LIMIT:
            fail('invalid-input')
        vault.write(encoded)
        return {'status': 'ok', 'revision': request['entry']['revision']}


def main():
    try:
        encoded = sys.stdin.buffer.read(LIMIT + 1)
        if len(encoded) > LIMIT:
            fail('invalid-input')
        response = perform(json.loads(encoded))
    except VaultError as error:
        response = {'status': str(error)}
    except Exception:
        response = {'status': 'unavailable'}
    response['version'] = 1
    sys.stdout.write(json.dumps(response, separators=(',', ':')))

if __name__ == '__main__':
    main()
