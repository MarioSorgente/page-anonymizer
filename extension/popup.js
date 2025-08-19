function send(msg) { return chrome.runtime.sendMessage(msg); }


async function refreshState() {
const res = await send({ type: 'PA_GET_STATE' });
document.getElementById('toggle').checked = !!res?.enabled;
}


document.getElementById('toggle').addEventListener('change', async () => {
await send({ type: 'PA_TOGGLE_ACTIVE' });
await refreshState();
});


document.getElementById('copyPage').addEventListener('click', async () => {
await send({ type: 'PA_COPY', selectionOnly: false });
window.close();
});


document.getElementById('copySel').addEventListener('click', async () => {
await send({ type: 'PA_COPY', selectionOnly: true });
window.close();
});


document.getElementById('openOptions').addEventListener('click', () => {
chrome.runtime.openOptionsPage();
});


refreshState();
