function registerClientConnections({ handle, runtimeHost, clipboard, isDevProfile, assertIdle, providerChanged }) {
  const run = async action => {
    let receipt, invalid = false, lines = 0;
    await runtimeHost.run('client-connections', ['connections', action], {
      embedded: true, privateOutput: true, timeoutMs: 20_000,
      message: 'Updating client connections', successMessage: 'Client connection settings read',
      // Private runtime output is deliberately not retained in result.stdout.
      // Consume one bounded receipt here without logging its API key.
      onStdoutLine: line => {
        if (++lines !== 1 || line.length > 32_768) { invalid = true; return true; }
        try { receipt = JSON.parse(line); } catch { invalid = true; }
        return true;
      },
    });
    if (invalid || !receipt) throw new Error('Client connection settings could not be read');
    if (receipt?.ok !== true) throw new Error(typeof receipt?.error === 'string' ? receipt.error : 'Client connection operation failed');
    return receipt;
  };
  handle('launcher:client-connections', async () => (await run('status')).value);
  handle('launcher:client-connection-action', async (_event, action) => {
    if (isDevProfile) throw new Error('Use the main NEKODEX profile to connect your installed clients');
    if (!['api-enable', 'api-disable', 'api-rotate', 'claude-connect', 'claude-disconnect', 'provider-mixed', 'provider-web-only', 'provider-picker-on', 'provider-picker-off'].includes(action)) {
      throw new Error('Unknown client connection action');
    }
    assertIdle();
    const receipt = await run(action);
    if (action.startsWith('provider-')) providerChanged(action.slice('provider-'.length));
    return receipt.value;
  });
  handle('launcher:copy-client-api-key', async () => {
    if (isDevProfile) throw new Error('Use the main NEKODEX profile to copy its API key');
    const receipt = await run('api-key');
    if (typeof receipt.key !== 'string' || !/^sk-local-[a-f0-9]{64}$/.test(receipt.key)) throw new Error('Local API returned an invalid key');
    clipboard.writeText(receipt.key);
    return { copied: true };
  });
}
module.exports = { registerClientConnections };
