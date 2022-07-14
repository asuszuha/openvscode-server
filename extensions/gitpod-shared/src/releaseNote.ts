/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { load } from 'js-yaml';

const LAST_READ_RELEASE_DATE = 'gitpod:releaseNote';

export function registerReleaseNoteView(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('gitpod.releaseNote', () => {
			ReleaseNotePanel.createOrShow(context);
		})
	);

	// TODO(hw): Remove
	context.subscriptions.push(
		vscode.commands.registerCommand('gitpod.cleanReleaseNoteCache', async () => {
			await context.globalState.update(LAST_READ_RELEASE_DATE, undefined);
		})
	);

	const lastRead = context.globalState.get<string>(LAST_READ_RELEASE_DATE);
	shouldShowReleaseNote(lastRead).then(shouldShow => {
		if (shouldShow) {
			ReleaseNotePanel.createOrShow(context);
		}
	});
}

async function getLastPublish() {
	// TODO(hw): fetch from somewhere
	return '2022-07-04';
}

async function shouldShowReleaseNote(lastRead: string | undefined) {
	const date = await getLastPublish();
	console.log(`lastSeen: ${lastRead}, latest publish: ${date} => ${date !== lastRead ? 'show' : 'not-show'} ===============hwen.shouldShow`);
	return date !== lastRead;
}

class ReleaseNotePanel {
	public static currentPanel: ReleaseNotePanel | undefined;
	public static readonly viewType = 'gitpodReleaseNote';
	private readonly panel: vscode.WebviewPanel;
	private lastRead: string | undefined;
	private _disposables: vscode.Disposable[] = [];

	private async loadChangelog(date: string) {
		// TODO(hw): fetch from somewhere
		console.log(date, fetch, 'ignore');
		const resp = await fetch(`https://raw.githubusercontent.com/gitpod-io/website/main/src/lib/contents/changelog/${date}.md`);
		if (!resp.ok) {
			throw new Error(`Getting GitHub account info failed: ${resp.statusText}`);
		}
		const md = await resp.text();

		const parseInfo = (md: string) => {
			if (!md.startsWith('---')) {
				return;
			}
			const lines = md.split('\n');
			const end = lines.indexOf('---', 1);
			const content = lines.slice(1, end).join('\n');
			return load(content) as { title: string; date: string; image: string; alt: string; excerpt: string };
		};
		const info = parseInfo(md);

		const content = md
			.replace(/---.*?---/gms, '')
			.replace(/<script>.*?<\/script>/gms, '')
			.replace(/<Badge.*?text="(.*?)".*?\/>/gim, '`$1`')
			.replace(/<Contributors usernames="(.*?)" \/>/gim, (_, p1) => {
				const users = p1
					.split(',')
					.map((e: string) => `[${e}](https://github.com/${e})`);
				return `Contributors: ${users.join(', ')}`;
			})
			.replace(/<p>(.*?)<\/p>/gm, '$1')
			.replace(/^[\n]+/m, '');
		if (!info) {
			return content;
		}

		return [
			`# ${info.title}`,
			`> Published at ${date}, see also https://gitpod.io/changelog`,
			`![${info.alt ?? 'image'}](https://www.gitpod.io/images/changelog/${info.image})`,
			content,
		].join('\n\n');
	}

	public async updateHtml(date?: string) {
		if (!date) {
			date = await getLastPublish();
		}
		const mdContent = await this.loadChangelog(date);
		const html = await vscode.commands.executeCommand('markdown.api.render', mdContent) as string;
		this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gitpod Release Note</title>
<style>
	${DEFAULT_MARKDOWN_STYLES}
</style>
</head>
<body>
${html}
</body>
</html>`;
		if (!this.lastRead || date > this.lastRead) {
			await this.context.globalState.update(LAST_READ_RELEASE_DATE, date);
			this.lastRead = date;
		}
	}

	public static createOrShow(context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (ReleaseNotePanel.currentPanel) {
			ReleaseNotePanel.currentPanel.panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			ReleaseNotePanel.viewType,
			'Gitpod Release Note',
			column || vscode.ViewColumn.One,
			{ enableScripts: true },
		);

		ReleaseNotePanel.currentPanel = new ReleaseNotePanel(context, panel);
	}

	public static revive(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
		ReleaseNotePanel.currentPanel = new ReleaseNotePanel(context, panel);
	}

	private constructor(
		private readonly context: vscode.ExtensionContext,
		panel: vscode.WebviewPanel
	) {
		this.lastRead = this.context.globalState.get<string>(LAST_READ_RELEASE_DATE);
		this.panel = panel;

		this.updateHtml();

		this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
		this.panel.onDidChangeViewState(
			() => {
				if (this.panel.visible) {
					this.updateHtml();
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		ReleaseNotePanel.currentPanel = undefined;
		this.panel.dispose();
		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}

// Align with https://github.com/gitpod-io/openvscode-server/blob/494f7eba3615344ee634e6bec0b20a1903e5881d/src/vs/workbench/contrib/markdown/browser/markdownDocumentRenderer.ts#L14
export const DEFAULT_MARKDOWN_STYLES = `
body {
	padding: 10px 20px;
	line-height: 22px;
	max-width: 882px;
	margin: 0 auto;
}

body *:last-child {
	margin-bottom: 0;
}

img {
	max-width: 100%;
	max-height: 100%;
}

a {
	text-decoration: none;
}

a:hover {
	text-decoration: underline;
}

a:focus,
input:focus,
select:focus,
textarea:focus {
	outline: 1px solid -webkit-focus-ring-color;
	outline-offset: -1px;
}

hr {
	border: 0;
	height: 2px;
	border-bottom: 2px solid;
}

h1 {
	padding-bottom: 0.3em;
	line-height: 1.2;
	border-bottom-width: 1px;
	border-bottom-style: solid;
}

h1, h2, h3 {
	font-weight: normal;
}

table {
	border-collapse: collapse;
}

table > thead > tr > th {
	text-align: left;
	border-bottom: 1px solid;
}

table > thead > tr > th,
table > thead > tr > td,
table > tbody > tr > th,
table > tbody > tr > td {
	padding: 5px 10px;
}

table > tbody > tr + tr > td {
	border-top-width: 1px;
	border-top-style: solid;
}

blockquote {
	margin: 0 7px 0 5px;
	padding: 0 16px 0 10px;
	border-left-width: 5px;
	border-left-style: solid;
}

code {
	font-family: "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace;
}

pre code {
	font-family: var(--vscode-editor-font-family);
	font-weight: var(--vscode-editor-font-weight);
	font-size: var(--vscode-editor-font-size);
	line-height: 1.5;
}

code > div {
	padding: 16px;
	border-radius: 3px;
	overflow: auto;
}

.monaco-tokenized-source {
	white-space: pre;
}

/** Theming */

.vscode-light code > div {
	background-color: rgba(220, 220, 220, 0.4);
}

.vscode-dark code > div {
	background-color: rgba(10, 10, 10, 0.4);
}

.vscode-high-contrast code > div {
	background-color: var(--vscode-textCodeBlock-background);
}

.vscode-high-contrast h1 {
	border-color: rgb(0, 0, 0);
}

.vscode-light table > thead > tr > th {
	border-color: rgba(0, 0, 0, 0.69);
}

.vscode-dark table > thead > tr > th {
	border-color: rgba(255, 255, 255, 0.69);
}

.vscode-light h1,
.vscode-light hr,
.vscode-light table > tbody > tr + tr > td {
	border-color: rgba(0, 0, 0, 0.18);
}

.vscode-dark h1,
.vscode-dark hr,
.vscode-dark table > tbody > tr + tr > td {
	border-color: rgba(255, 255, 255, 0.18);
}

`;
