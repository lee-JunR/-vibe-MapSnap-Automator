const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        title: "비용 정산 증빙 자동화",
        icon: path.join(__dirname, 'icon.png') // Optional: add an icon later
    });

    // Start the Express server as a background process
    serverProcess = fork(path.join(__dirname, 'server.js'));

    serverProcess.on('message', (msg) => {
        if (msg === 'server-started') {
            mainWindow.loadURL('http://localhost:3000');
        }
    });

    // Handle initial load in case message is missed or delayed
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 2000);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

// Ensure the server process is killed when the app exits
app.on('will-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});
