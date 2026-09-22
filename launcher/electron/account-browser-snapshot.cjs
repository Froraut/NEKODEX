/** Pure cross-account display projection; never owns hosts, ledgers or leases. */
function projectAccountBrowserSnapshot({ observation, selectedId, accounts, selectedState, accountTabs,
  taskHistories, workspaces, queue, maxTabs }) {
  const labels = new Map(accounts.map(({ id, label }) => [id, label]));
  const historyIssues = new Map(taskHistories.map(({ accountId, issue }) => [accountId, issue]));
  return {
    ...selectedState, observation, accountId: selectedId, accountName: labels.get(selectedId), maxTabs,
    ...(workspaces ? { workspaces } : {}),
    queue: queue ? { ...queue, accounts: accounts.map(({ id, label }) => ({ id, label })) } : undefined,
    taskHistoryHealth: accounts.filter(({ id }) => historyIssues.get(id) === 'task-history-unavailable')
      .map(({ id, label }) => ({ accountId: id, accountName: label, issue: 'task-history-unavailable' })),
    tasks: taskHistories.flatMap(({ accountId, tasks }) => tasks.map(task => ({
      ...task, accountId, accountName: labels.get(accountId),
    }))).sort((a, b) => b.createdAt - a.createdAt),
    tabs: [
      ...selectedState.tabs.filter(tab => tab.id === 'home'),
      ...accountTabs.flatMap(({ accountId, tabs }) => tabs.filter(tab => tab.id !== 'home').map(tab => ({
        ...tab, active: accountId === selectedId && tab.active, accountId,
        title: `${labels.get(accountId)} · ${tab.title}`,
      }))),
    ],
  };
}

module.exports = { projectAccountBrowserSnapshot };
