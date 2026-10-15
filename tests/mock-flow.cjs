"use strict";

// Exercises the real page script with SDK callbacks, without using a platform credential.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this._text = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  get innerText() { return this.textContent; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.(); }
  remove() {}
}

const elements = new Map();
const get = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
get("interviewer-persona").value = "warm";
get("language-style").value = "natural";
get("job-title").value = "数据分析师";
get("job-level").value = "mid";
get("job-responsibilities").value = "分析用户转化漏斗\n维护业务指标看板\n设计并分析 A/B 实验";
get("job-requirements").value = "熟悉 SQL 和统计分析";
get("question-mode").value = "generated";
get("question-count").value = "3";

let instance;
let downloadedBlob;
let speechInstance;
class FakeSpeechRecognition {
  constructor() { speechInstance = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  emit(text, isFinal = false) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal }] });
  }
}
class FakeSDK {
  constructor(config) {
    this.callbacks = config.agentCallbacks;
    this.requests = [];
    instance = this;
  }
  async init() {}
  async ask(text) { this.requests.push(text); }
  async startASR() {}
  async stopASR() {}
  async interrupt() {}
  async destroy() {}
  complete(text) {
    if (text) {
      this.callbacks.onLLMResponse({ event: "chunk", text: text.slice(0, 2) });
      this.callbacks.onLLMResponse({ event: "chunk", text: text.slice(2) });
      this.callbacks.onLLMResponse({ event: "done", text });
    }
    this.callbacks.onConversationChange({ state: "completed" });
  }
}

const document = {
  getElementById: get,
  createElement: () => new Element(),
  body: new Element(),
  head: new Element(),
};
const window = { XingyunAvatarAgent: FakeSDK, SpeechRecognition: FakeSpeechRecognition, isSecureContext: true, addEventListener() {} };
const testURL = { createObjectURL(blob) { downloadedBlob = blob; return "blob:test"; }, revokeObjectURL() {} };
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(script, "page script exists");
vm.runInNewContext(script, {
  document,
  window,
  location: { protocol: "http:" },
  fetch: async () => ({ ok: true, json: async () => ({ configured: true, appId: "test-app", appSecret: "test-secret" }) }),
  URL: testURL,
  Blob,
  setTimeout,
  clearTimeout,
  console,
});
const settle = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  await settle();
  await settle();
  assert.equal(get("status").textContent, "已连接");

  get("job-title").value = "";
  get("job-title").listeners.input();
  assert.equal(get("start-interview-btn").disabled, true, "missing job blocks start");
  get("start-interview-btn").click();
  await settle();
  assert.equal(instance.requests.length, 0);
  get("job-title").value = "数据分析师";
  get("job-title").listeners.input();

  get("start-interview-btn").click();
  await settle();
  assert.match(instance.requests[0], /数据分析师/);
  assert.match(instance.requests[0], /分析用户转化漏斗/);
  assert.match(instance.requests[0], /熟悉 SQL 和统计分析/);
  assert.doesNotMatch(instance.requests[0], /前端开发|JavaScript/);
  assert.match(get("interview-topic").textContent, /1 \/ 3/);
  assert.equal(get("job-title").disabled, true, "job stays locked while interviewing");
  assert.equal(get("ask-btn").disabled, true, "cannot answer before question completes");
  assert.equal(get("next-topic-btn").disabled, true, "cannot skip an unanswered question");
  instance.complete("请介绍一下自己和申请岗位的原因？");
  assert.equal(get("ask-btn").disabled, false);
  assert.match(get("interviewer-caption").textContent, /请介绍一下自己/);

  get("question").value = "我做过一个小型前端项目。";
  get("ask-btn").click();
  await settle();
  assert.equal(get("next-topic-btn").disabled, true, "cannot advance before response completes");
  instance.complete("这个项目中你具体负责什么？");
  assert.equal(get("next-topic-btn").disabled, false);
  assert.equal(get("ask-btn").disabled, false, "one supplementary answer is allowed");

  get("question").value = "我负责页面组件和接口联调。";
  get("ask-btn").click();
  await settle();
  instance.complete("了解，谢谢你的补充。");
  assert.equal(get("ask-btn").disabled, true, "no third answer in one topic");
  assert.equal(get("next-topic-btn").disabled, false);

  get("next-topic-btn").click();
  await settle();
  assert.equal(get("ask-btn").disabled, true);
  instance.complete("");
  assert.equal(get("retry-question-btn").hidden, false, "missing SDK text needs a retry");
  get("retry-question-btn").click();
  await settle();
  instance.complete("介绍一个你参与过的项目？");
  get("start-asr-btn").click();
  await settle();
  speechInstance.emit("我参与了", false);
  speechInstance.emit("我参与了校园活动网站。", true);
  assert.equal(get("next-topic-btn").disabled, true, "speech segments do not submit before manual stop");
  get("stop-asr-btn").click();
  speechInstance.onend?.();
  await settle();
  assert.equal(get("next-topic-btn").disabled, true);
  instance.complete("你怎样验证这个网站的效果？");
  assert.equal(get("next-topic-btn").disabled, false);

  get("finish-interview-btn").click();
  await settle();
  assert.equal(get("download-report-btn").disabled, true, "wait for closing response before export");
  instance.complete("你的项目描述清楚，建议补充可验证的结果。");
  const reportText = get("report-content").textContent;
  assert.match(reportText, /问题：「请介绍一下自己和申请岗位的原因？/);
  assert.match(reportText, /回答（文字）：「我做过一个小型前端项目。/);
  assert.match(reportText, /面试官回应：「这个项目中你具体负责什么？/);
  assert.match(reportText, /补答（文字）：「我负责页面组件和接口联调。/);
  assert.match(reportText, /我参与了校园活动网站/);
  assert.match(reportText, /面试总分/);
  assert.match(reportText, /精准度\d+ \/ 10/);
  assert.match(reportText, /岗位专业性\d+ \/ 10/);
  assert.match(reportText, /表述方式\d+ \/ 10/);
  assert.match(reportText, /缺口：/);
  assert.match(reportText, /下一次练习：/);

  get("download-report-btn").click();
  const exportData = JSON.parse(await downloadedBlob.text());
  assert.equal(exportData.interviewerMessages[0].text, "请介绍一下自己和申请岗位的原因？");
  assert.equal(exportData.answers.length, 3);
  assert.equal(exportData.position, "数据分析师");
  assert.equal(exportData.questionPlan.length, 3);
  assert.equal(exportData.jobConfig.level, "mid");
  assert.equal(exportData.scores.scale, "0-10");
  assert.equal(exportData.scores.questions.length, 3);
  assert.ok(exportData.scores.total >= 0 && exportData.scores.total <= 10);
  assert.deepEqual(exportData.scores.weights, { precision: 0.4, professional: 0.4, expression: 0.2 });

  get("job-title").value = "产品经理";
  get("job-responsibilities").value = "梳理用户需求；制定产品方案";
  get("job-requirements").value = "能设计并验证产品指标";
  get("question-mode").value = "custom";
  get("custom-questions").value = "请讲一次你判断需求优先级的经历？\n如何验证一个新功能是否有效？";
  get("question-mode").listeners.change();
  assert.equal(get("custom-questions-block").hidden, false);
  assert.match(get("job-validation").textContent, /共 2 题/);
  get("download-report-btn").click();
  const unchanged = JSON.parse(await downloadedBlob.text());
  assert.equal(unchanged.position, "数据分析师", "draft edits do not rewrite an existing report");
  get("retry-topic").value = "0";
  get("retry-btn").click();
  await settle();
  assert.match(instance.requests.at(-1), /数据分析师/);
  assert.doesNotMatch(instance.requests.at(-1), /产品经理/);
  instance.complete("请介绍一段与你的数据分析职责相关的经历？");
  get("finish-interview-btn").click();
  await settle();
  instance.complete("这次重练结束。");

  get("start-interview-btn").click();
  await settle();
  assert.match(instance.requests.at(-1), /产品经理/);
  assert.match(instance.requests.at(-1), /请讲一次你判断需求优先级的经历？/);
  assert.match(instance.requests.at(-1), /按原文/);
  assert.match(get("interview-topic").textContent, /1 \/ 2/);
  instance.complete("请讲一次你判断需求优先级的经历？");
  get("question").value = "我结合用户影响、工作量和业务收益排序。";
  get("ask-btn").click();
  await settle();
  instance.complete("谢谢。");
  assert.equal(get("ask-btn").disabled, true, "a sufficient answer does not invite another answer");
  assert.equal(get("next-topic-btn").disabled, false, "a sufficient answer goes directly to the next question");
  get("next-topic-btn").click();
  await settle();
  assert.match(instance.requests.at(-1), /如何验证一个新功能是否有效？/);
  instance.complete("如何验证一个新功能是否有效？");
  get("finish-interview-btn").click();
  await settle();
  instance.complete("面试结束。");
  get("download-report-btn").click();
  const customExport = JSON.parse(await downloadedBlob.text());
  assert.equal(customExport.position, "产品经理");
  assert.equal(customExport.questionPlan[1].question, "如何验证一个新功能是否有效？");
  assert.equal(customExport.answers.length, 1, "new interview resets previous answers");

  get("question-mode").value = "generated";
  get("question-count").value = "1";
  get("question-mode").listeners.change();
  assert.match(get("job-validation").textContent, /共 1 题/);
  get("question-count").value = "11";
  get("question-count").listeners.input();
  assert.equal(get("start-interview-btn").disabled, true, "question limit is validated");
  get("question-count").value = "1";
  get("question-count").listeners.input();
  get("start-interview-btn").click();
  await settle();
  assert.match(get("interview-topic").textContent, /1 \/ 1/);
  assert.match(instance.requests.at(-1), /梳理用户需求；制定产品方案/);
  console.log("Mock SDK interview flow passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
