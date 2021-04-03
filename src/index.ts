import {Page} from "puppeteer";

require('dotenv').config();
import {usageOptions, cmdOptions} from "./cli-config";
const puppeteer = require("puppeteer");
const cmdArgs = require('command-line-args');
const cmdUsage = require('command-line-usage');

const usage = cmdUsage(usageOptions);
const args = cmdArgs(cmdOptions);

const { game, timeout, verbose, help } = args
const headless = !args['no-headless'];

if (help || !game) {
    console.log(usage);
    process.exit(0);
}

if (!process.env.TWITCH_CHROME_EXECUTABLE) {
    throw new Error('TWITCH_CHROME_EXECUTABLE not set')
}
if (!process.env.TWITCH_AUTH_TOKEN) {
    throw new Error('TWITCH_AUTH_TOKEN not set')
} 

const directoryUrl = `https://www.twitch.tv/directory/game/${game}?tl=c2542d6d-cd10-4532-919b-3d19f30a768b`;

function info(msg: string) {
    console.info(`[${new Date().toUTCString()}] ${msg}`);
}

function vinfo(msg: string) {
    if (!verbose) return;
    info(`[VERBOSE] ${msg}`);
}

async function initTwitch(page: Page) {
    info('Navigating to Twitch');
    await page.goto('https://twitch.tv', {
        waitUntil: ['networkidle2', 'domcontentloaded']
    });
    info('Configuring streaming settings');
    await page.evaluate(() => {
        localStorage.setItem('mature', 'true');
        localStorage.setItem('video-muted', '{"default":true}');
        localStorage.setItem('volume', '0.0');
        localStorage.setItem('video-quality', '{"default":"160p30"}');
    });
    info('Signing in using auth-token')
    await page.setCookie(
        {
            name: 'auth-token',
            value: process.env.TWITCH_AUTH_TOKEN
        }
    );
}

async function findCOnlineChannel(page: Page) {
    info('Finding online channel...');
    await page.goto(directoryUrl, {
        waitUntil: ['networkidle2', 'domcontentloaded']
    });
    const aHandle = await page.waitForSelector('a[data-a-target="preview-card-image-link"]', {timeout: 0});
    const channel = await page.evaluate(a => a.getAttribute('href'), aHandle);
    info('Channel found: navigating');
    await page.goto(`https://twitch.tv${channel}`, {
        waitUntil: ['networkidle2', 'domcontentloaded']
    });
}

async function checkInventory(inventory: Page) {
    await inventory.goto('https://twitch.tv/inventory', {
        waitUntil: ['networkidle2', 'domcontentloaded']
    });
    const claimButton = (await inventory.$('button[data-test-selector="DropsCampaignInProgressRewardPresentation-claim-button"]'));
    vinfo(`Claim button found: ${!!claimButton}`);
    if (claimButton) {
        info('Reward found! Claiming!')
        await new Promise(resolve => setTimeout(resolve, 1000));
        await claimButton.click();
    }
}

async function checkLiveStatus(mainPage: Page) {
    const status = await mainPage.$$eval('a[status]', li => li.pop()?.getAttribute('status'));
    vinfo(`Channel status: ${status}`);
    if (status !== 'tw-channel-status-indicator--live') {
        info('Channel no longer live')
        await findCOnlineChannel(mainPage);
    }
}

async function runTimer(mainPage: Page, inventory: Page) {
    vinfo('Timer function called')
    await checkInventory(inventory);
    await checkLiveStatus(mainPage);
    setTimeout(runTimer, timeout, mainPage, inventory);
}

async function run() {
    info('Starting application');
    const browser = await puppeteer.launch({
        executablePath: process.env.TWITCH_CHROME_EXECUTABLE,
        headless: headless
    });
    const mainPage = (await browser.pages())[0];
    await mainPage.setViewport({ width: 1280, height: 720 })
    await initTwitch(mainPage);
    
    const inventory = await browser.newPage();
    await inventory.setViewport({ width: 1280, height: 720 })
    await mainPage.bringToFront();
    
    await findCOnlineChannel(mainPage);
    setTimeout(runTimer, timeout, mainPage, inventory);
}

run().then(r => {
    // Nothing
});