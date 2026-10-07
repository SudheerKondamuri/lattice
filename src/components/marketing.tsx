"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  FileText,
  GitBranch,
  Globe2,
  History,
  Mail,
  Menu,
  Minus,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Brand, Mark } from "./brand";
import { MarketingHero } from "./marketing-hero";

const capabilities = [
  ["Website crawl", Globe2],
  ["Sitemaps", Search],
  ["PDFs", FileText],
  ["Markdown", Code2],
  ["Q&A sheets", Clipboard],
  ["Approved answers", CircleCheck],
  ["Inspectable citations", BookOpen],
  ["Regression checks", CheckCheck],
  ["Release snapshots", History],
  ["Instant rollback", RotateCcw],
  ["Email handoff", Mail],
  ["Allowed origins", ShieldCheck],
] as const;

const workflowSteps = [
  {
    id: "import",
    title: "Import",
    sentence: "Bring in the sources your team already trusts and see what needs review before it enters the draft.",
    icon: Upload,
  },
  {
    id: "inspect",
    title: "Inspect",
    sentence: "Open the passage behind an answer, its source version, and the warning that still needs your attention.",
    icon: BookOpen,
  },
  {
    id: "test",
    title: "Test",
    sentence: "Run owner-approved questions against the candidate and compare them with the answer you had before.",
    icon: CheckCheck,
  },
  {
    id: "publish",
    title: "Publish",
    sentence: "Ship one reviewed release, keep its pointer reversible, and know exactly what visitors will see.",
    icon: PackageCheck,
  },
] as const;

const plans = [
  {
    name: "Starter",
    price: "$39",
    description: "For a small team that wants a dependable first support loop.",
    features: [
      "1,000 completed customer replies",
      "250 indexed source pages",
      "100 OCR / visual pages",
      "200 quality-check cases",
      "2 team members",
      "Daily website checking",
      "Comparison and correction workflow",
      "Branding removal included",
    ],
  },
  {
    name: "Growth",
    price: "$99",
    description: "For a support team with more questions and more release history.",
    features: [
      "4,000 completed customer replies",
      "1,000 indexed source pages",
      "250 OCR / visual pages",
      "500 quality-check cases",
      "5 team members",
      "Daily website checking",
      "Comparison and correction workflow",
      "Branding removal included",
    ],
  },
] as const;

const faqs = [
  [
    "How is Lattice different?",
    "Lattice puts source inspection, answer correction, comparison, and publishing in one connected workflow. You can see the evidence, decide what changed, and keep a reversible release instead of hoping the next answer is better.",
  ],
  [
    "Can I bring my knowledge from Chatbase?",
    "Yes. Re-crawl the website or sitemap, upload PDFs and Markdown, and import Q&A sheets. Imported questions remain evaluation-only until someone deliberately promotes a cleaned answer into customer-facing knowledge.",
  ],
  [
    "Do I need to replace my helpdesk?",
    "No. Unanswered questions can hand off the transcript, contact details, and context by email to the support inbox you already use. The team replies from there.",
  ],
  [
    "Is the product ready to connect to my customers?",
    "Test it in the playground and installation preview first. Publish a reviewed release when the answers are ready, then use allowed origins to control where the widget runs. Live provider and deployment verification are still explicit release gates.",
  ],
] as const;

function MarketingHeader({
  menu,
  scrolled,
  setMenu,
}: {
  menu: boolean;
  scrolled: boolean;
  setMenu: (open: boolean) => void;
}) {
  return (
    <header className={scrolled ? "site-header is-scrolled" : "site-header"}>
      <div className="site-header-inner">
        <Brand light={!scrolled} />
        <nav
          id="marketing-navigation"
          className={menu ? "site-nav is-open" : "site-nav"}
          aria-label="Main navigation"
        >
          <a href="#product" onClick={() => setMenu(false)}>
            Product
          </a>
          <a href="#compare" onClick={() => setMenu(false)}>
            Compare
          </a>
          <a href="#pricing" onClick={() => setMenu(false)}>
            Pricing
          </a>
          <a href="#faq" onClick={() => setMenu(false)}>
            FAQ
          </a>
        </nav>
        <Link href="/app" className="header-workspace">
          Open workspace <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <button
          className="mobile-menu icon-button"
          onClick={() => setMenu(!menu)}
          aria-label={menu ? "Close navigation" : "Open navigation"}
          aria-controls="marketing-navigation"
          aria-expanded={menu}
          type="button"
        >
          {menu ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

function SectionHeading({
  children,
  description,
  tone = "light",
}: {
  children: React.ReactNode;
  description: string;
  tone?: "light" | "dark";
}) {
  return (
    <div className={`marketing-section-heading is-${tone}`}>
      <h2>{children}</h2>
      <p>{description}</p>
    </div>
  );
}

function CapabilityMarquee() {
  const [paused, setPaused] = useState(false);

  return (
    <section id="product" className="marketing-marquee marketing-cream">
      <div className="marketing-container">
        <SectionHeading
          description="A website-first support stack for teams that need to keep answers current without rebuilding their help center."
        >
          Everything your support bot needs to stay right.
        </SectionHeading>
        <div className="capability-marquee-shell">
          <div
            className={
              paused
                ? "capability-marquee-track is-paused"
                : "capability-marquee-track"
            }
            onFocus={() => setPaused(true)}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <ul className="capability-list" aria-label="Lattice capabilities">
              {capabilities.map(([label, Icon]) => (
                <li className="capability-pill" key={label}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            <ul className="capability-list" aria-hidden="true">
              {capabilities.map(([label, Icon]) => (
                <li className="capability-pill" key={`repeat-${label}`}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            className="marquee-toggle"
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            <span>{paused ? "Play capabilities" : "Pause capabilities"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function ImportPanel() {
  return (
    <div className="workflow-panel-content">
      <div className="source-panel-header">
        <span>Sources / draft knowledge</span>
        <span className="demo-status is-neutral">3 in review</span>
      </div>
      <div className="source-rows">
        <div className="source-row">
          <Globe2 size={18} aria-hidden="true" />
          <span><strong>help.example.com</strong><small>Website crawl · 18 pages discovered</small></span>
          <span className="demo-status is-running"><Clock3 size={12} aria-hidden="true" /> running</span>
        </div>
        <div className="source-row">
          <FileText size={18} aria-hidden="true" />
          <span><strong>setup-guide.pdf</strong><small>PDF · page references retained</small></span>
          <span className="demo-status is-success"><CircleCheck size={12} aria-hidden="true" /> succeeded</span>
        </div>
        <div className="source-row">
          <Clipboard size={18} aria-hidden="true" />
          <span><strong>support-questions.csv</strong><small>Q&amp;A sheet · evaluation-only</small></span>
          <span className="demo-status is-warning"><CircleAlert size={12} aria-hidden="true" /> needs review</span>
        </div>
      </div>
      <div className="panel-footnote"><Upload size={14} aria-hidden="true" /> Partial extraction stays visible before publish.</div>
    </div>
  );
}

function InspectPanel() {
  return (
    <div className="workflow-panel-content">
      <div className="evidence-panel-header">
        <span>Answer evidence</span>
        <span className="demo-status is-success"><CircleCheck size={12} aria-hidden="true" /> grounded</span>
      </div>
      <div className="evidence-question">Can I export on the Starter plan?</div>
      <div className="evidence-answer">Yes. Starter includes <strong>1,000 rows per export.</strong></div>
      <div className="evidence-drawer">
        <div className="evidence-drawer-title"><BookOpen size={16} aria-hidden="true" /><span><strong>Plans &amp; exports</strong><small>Source v04 · section 3</small></span><Search size={15} aria-hidden="true" /></div>
        <p>Starter includes <mark>1,000 rows per export.</mark> Open Settings → Workspace → Export data.</p>
      </div>
      <div className="panel-footnote"><ShieldCheck size={14} aria-hidden="true" /> Archived passages cannot silently become current evidence.</div>
    </div>
  );
}

function TestPanel() {
  return (
    <div className="workflow-panel-content">
      <div className="test-panel-header"><span>Regression suite / release 04</span><span className="demo-status is-success"><CheckCheck size={12} aria-hidden="true" /> 3 checked</span></div>
      <div className="test-columns"><span>Question</span><span>Candidate</span><span>Baseline</span></div>
      {[
        ["Export limits", "PASS", "FAIL"],
        ["Refund window", "PASS", "PASS"],
        ["Unsupported question", "HANDOFF", "HANDOFF"],
      ].map(([question, candidate, baseline]) => (
        <div className="test-row" key={question}>
          <span>{question}</span><strong className={candidate === "FAIL" ? "is-fail" : "is-pass"}>{candidate}</strong><strong className={baseline === "FAIL" ? "is-fail" : "is-pass"}>{baseline}</strong>
        </div>
      ))}
      <div className="panel-footnote"><CircleAlert size={14} aria-hidden="true" /> Human verdicts stay separate from preliminary grading.</div>
    </div>
  );
}

function PublishPanel() {
  return (
    <div className="workflow-panel-content">
      <div className="release-panel-header"><span>Release 04 / next publish</span><span className="demo-status is-warning">draft</span></div>
      <div className="release-diff-row is-added"><Plus size={15} aria-hidden="true" /><span>Plans &amp; exports · v04</span></div>
      <div className="release-diff-row is-added"><Plus size={15} aria-hidden="true" /><span>Approved answer · Starter exports</span></div>
      <div className="release-diff-row is-edited"><RefreshCw size={15} aria-hidden="true" /><span>Behavior instruction · handoff wording</span></div>
      <div className="release-actions"><span className="demo-control is-primary"><PackageCheck size={15} aria-hidden="true" /> Atomic publish</span><span className="demo-control"><RotateCcw size={15} aria-hidden="true" /> Rollback</span></div>
      <div className="panel-footnote"><GitBranch size={14} aria-hidden="true" /> The pointer changes atomically; history stays retained.</div>
    </div>
  );
}

function WorkflowPanel({ step }: { step: number }) {
  if (step === 0) return <ImportPanel />;
  if (step === 1) return <InspectPanel />;
  if (step === 2) return <TestPanel />;
  return <PublishPanel />;
}

function PinnedWorkflow() {
  const [activeStep, setActiveStep] = useState(0);
  const workflowRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 851px)").matches) return;
    const root = workflowRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-workflow-step]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveStep(Number((visible.target as HTMLElement).dataset.workflowStep));
      },
      { rootMargin: "-35% 0px -45% 0px", threshold: [0.15, 0.5, 0.85] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="workflow" className="marketing-workflow marketing-cream" ref={workflowRef}>
      <div className="marketing-container">
        <SectionHeading description="The release is the unit of trust. Move from source material to a customer-visible answer without losing the trail between them.">
          From first document to published answer.
        </SectionHeading>
        <div className="workflow-layout">
          <div className="workflow-rail">
            <div className="workflow-progress" aria-hidden="true"><span className={`workflow-progress-fill step-${activeStep + 1}`} /></div>
            <ol className="workflow-step-list" aria-label="Lattice publishing workflow">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li className="workflow-step" data-workflow-step={index} key={step.id}>
                    <button className={activeStep === index ? "workflow-step-button is-active" : "workflow-step-button"} type="button" aria-current={activeStep === index ? "step" : undefined} aria-controls={`workflow-panel-${step.id}`} onClick={() => setActiveStep(index)}>
                      <span className="workflow-step-icon"><Icon size={18} aria-hidden="true" /></span>
                      <span><strong>{step.title}</strong><small>{step.sentence}</small></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="workflow-stage">
            <div className="workflow-stage-sticky">
              <span className="illustrative-label">Illustrative workspace state · static seeded example</span>
              {workflowSteps.map((step, index) => (
                <article id={`workflow-panel-${step.id}`} className={activeStep === index ? "workflow-stage-panel is-active" : "workflow-stage-panel"} key={step.id}>
                  <WorkflowPanel step={index} />
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type ImproveStage = 0 | 1 | 2 | 3;

function ImproveDemo() {
  const [stage, setStage] = useState<ImproveStage>(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPlaying(true);
          setRun((value) => value + 1);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) {
      setStage(3);
      return;
    }
    setStage(0);
    const timers = [
      window.setTimeout(() => setStage(1), 1200),
      window.setTimeout(() => setStage(2), 2700),
      window.setTimeout(() => setStage(3), 4300),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [playing, reducedMotion, run]);

  const replay = () => {
    setStage(0);
    setPlaying(true);
    setRun((value) => value + 1);
  };

  return (
    <section className="marketing-improve" ref={sectionRef}>
      <div className="marketing-container improve-layout">
        <div className="improve-copy">
          <SectionHeading tone="dark" description="The fix is not the finish line. Lattice checks the neighboring questions, records the release, and keeps rollback close.">
            Fix a wrong answer once. Prove it stays fixed.
          </SectionHeading>
          <div className="improve-copy-note"><CircleCheck size={18} aria-hidden="true" /><span>One correction. A smaller repeat-failure surface.</span></div>
          <button className="button button-cream" type="button" onClick={() => { setPlaying(true); setRun((value) => value + 1); }}>
            Improve this answer <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="improve-demo-shell">
          <div className="improve-demo-topline">
            <span className="illustrative-label is-dark">Illustrative correction run</span>
            <button className="replay-button" type="button" onClick={replay} aria-label="Replay correction workflow">
              <RotateCcw size={15} aria-hidden="true" /> Replay
            </button>
          </div>
          <div className="improve-demo-window" aria-live="polite">
            <div className="improve-demo-progress" aria-hidden="true">
              {[
                ["Inspect", 0],
                ["Repair", 1],
                ["Check", 2],
                ["Publish", 3],
              ].map(([label, value]) => (
                <span className={stage >= Number(value) ? "is-current" : ""} key={label as string}><i />{label}</span>
              ))}
            </div>
            {stage === 0 && (
              <div className="improve-state is-inspect">
                <div className="conversation-line is-user"><span>Visitor</span><strong>Can I export on Starter?</strong></div>
                <div className="conversation-line is-wrong"><span>Bot answer</span><strong>No. Exports are available on Growth.</strong></div>
                <button className="improve-trigger" type="button" onClick={() => { setPlaying(true); setRun((value) => value + 1); }}><Search size={15} aria-hidden="true" /> Improve this answer</button>
                <div className="retrieved-passage"><span>Retrieved passage</span><p>Starter includes <mark>1,000 rows per export.</mark></p><small>Plans &amp; exports · source v04</small></div>
              </div>
            )}
            {stage === 1 && (
              <div className="improve-state is-repair">
                <div className="state-heading"><span>Approved answer snippet</span><span className="demo-status is-success">ready to save</span></div>
                <div className="typed-snippet">Yes. Starter includes <strong>1,000 rows per export.</strong> Open Settings → Workspace → Export data.<span className="typing-caret" aria-hidden="true" /></div>
                <div className="state-foot"><ShieldCheck size={15} aria-hidden="true" /> Linked to Plans &amp; exports · source v04</div>
              </div>
            )}
            {stage === 2 && (
              <div className="improve-state is-check">
                <div className="state-heading"><span>Saved check / export limits</span><span className="demo-status is-warning">review</span></div>
                <div className="candidate-baseline"><div><small>Candidate</small><p>Starter includes <mark>1,000 rows per export.</mark></p><strong className="is-pass"><Check size={13} aria-hidden="true" /> supported</strong></div><div><small>Baseline</small><p>Exports are available on the Growth plan.</p><strong className="is-fail"><CircleAlert size={13} aria-hidden="true" /> missing detail</strong></div></div>
                <div className="state-foot"><CheckCheck size={15} aria-hidden="true" /> Related cases are ready for owner review.</div>
              </div>
            )}
            {stage === 3 && (
              <div className="improve-state is-publish">
                <div className="publish-stamp"><PackageCheck size={22} aria-hidden="true" /><span>Release 05 created</span></div>
                <p>Visitors will answer from the reviewed release. The previous pointer remains available for rollback.</p>
                <div className="publish-pointer"><GitBranch size={15} aria-hidden="true" /><span>current → release 05</span><button type="button">Review rollback</button></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  const [verdict, setVerdict] = useState<"candidate" | "baseline" | "tie" | null>(null);

  return (
    <section id="compare" className="marketing-comparison marketing-dark">
      <div className="marketing-container">
        <SectionHeading tone="dark" description="Use your own questions, context, and baseline answers. Lattice shows the tradeoffs; your team makes the verdict.">
          Don&apos;t take our word for it.
        </SectionHeading>
        <div className="comparison-grid">
          <div className="comparison-intro">
            <div className="illustrative-label is-dark">Illustrative comparison</div>
            <p className="comparison-question">Can I export on the Starter plan?</p>
            <p className="comparison-intro-copy">A current answer is only useful when the team can see what changed and why it is supported.</p>
            <Link href="/app/compare" className="button button-cream">Make your own comparison <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
          <div className="comparison-art">
            <div className="comparison-answer-grid">
              <article className="comparison-answer is-baseline"><span className="comparison-kicker">Previous answer</span><p>CSV exports are available on the Growth plan. You can upgrade in your settings.</p><span className="comparison-flag"><Minus size={13} aria-hidden="true" /> Missing plan details</span></article>
              <article className="comparison-answer is-candidate"><span className="comparison-kicker">With the right knowledge</span><p>Yes. Starter includes <mark>1,000 rows per export.</mark> Open Settings → Workspace → Export data.</p><span className="comparison-source"><Check size={13} aria-hidden="true" /> Supported by source [01]</span></article>
            </div>
            <div className="verdict-bar"><span>Human verdict</span><div className="verdict-buttons" role="group" aria-label="Comparison verdict">
              {([["candidate", "Candidate better"], ["baseline", "Baseline better"], ["tie", "Tie"]] as const).map(([value, label]) => <button className={verdict === value ? "is-selected" : ""} type="button" aria-pressed={verdict === value} onClick={() => setVerdict(value)} key={value}>{label}</button>)}
            </div></div>
            <div className="verdict-result" aria-live="polite">{verdict ? `Selected: ${verdict === "candidate" ? "Candidate better" : verdict === "baseline" ? "Baseline better" : "Tie"}.` : "Choose the verdict your team can stand behind."}</div>
          </div>
        </div>
        {/* Verify every comparison claim against current product behavior before publishing this table. */}
         <div className="comparison-table-wrap" tabIndex={0} role="region" aria-label="Feature comparison table">
          <table className="comparison-table"><caption>Lattice vs a typical chatbot builder</caption><thead><tr><th scope="col">Workflow capability</th><th scope="col">Lattice</th><th scope="col">Typical builder</th></tr></thead><tbody>
            {["Version history", "Regression checks", "Instant rollback", "Inspectable citations", "Email handoff"].map((row) => <tr key={row}><th scope="row">{row}</th><td><Check size={15} aria-label="Included" /> Present</td><td>Verify for your setup</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  const [copied, setCopied] = useState(false);
  const [question, setQuestion] = useState("Can I export on Starter?");
  const [answer, setAnswer] = useState("Yes — Starter includes 1,000 rows per export.");
  const snippet = '<script src="https://YOUR_FRONTEND/lattice-widget.js" data-agent="BACKEND_AGENT_UUID" defer></script>';

  const copySnippet = async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission is optional in the preview; leave the control ready to retry.
    }
  };

  const askWidget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = question.toLowerCase();
    setAnswer(normalized.includes("export") ? "Yes — Starter includes 1,000 rows per export." : "I’m not confident enough to answer that. The team can reply by email with the transcript.");
  };

  return (
    <section id="install" className="marketing-install marketing-cream">
      <div className="marketing-container">
        <SectionHeading description="Publish approved knowledge, allow the installing site, and keep the visitor experience inside a sandboxed frame.">
          One line on your site.
        </SectionHeading>
        <div className="install-grid">
          <div className="install-copy">
            <div className="embed-code-card"><div className="code-card-header"><span><Code2 size={15} aria-hidden="true" /> Embed snippet</span><button type="button" onClick={copySnippet} aria-label={copied ? "Embed snippet copied" : "Copy embed snippet"}>{copied ? <CheckCheck size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button></div><pre><code>{snippet}</code></pre><div className="code-card-foot">Replace the placeholders with the published agent and your frontend origin.</div></div>
            <ul className="safety-list"><li><ShieldCheck size={18} aria-hidden="true" /><span><strong>Sandboxed iframe</strong><small>The widget runs on the frontend origin, not inside dashboard chrome.</small></span></li><li><History size={18} aria-hidden="true" /><span><strong>No dashboard cookies</strong><small>Visitor sessions use public APIs and an opaque visitor token.</small></span></li><li><Globe2 size={18} aria-hidden="true" /><span><strong>Allowed origins</strong><small>Only approved installing sites can use the published agent.</small></span></li></ul>
          </div>
           <div className="mini-widget-shell"><span className="illustrative-label">Illustrative visitor widget</span><div className="mini-widget"><div className="mini-widget-header"><span className="mini-avatar"><Mark size={15} /></span><span><strong>Lattice support</strong><small>Grounded in your knowledge</small></span><span className="online-dot" aria-hidden="true" /></div><div className="mini-message is-user">{question}</div><div className="mini-message is-agent"><p>{answer}</p><span className="mini-citation">[01] Plans &amp; exports <ArrowUpRight size={11} aria-hidden="true" /></span></div><form className="mini-widget-form" onSubmit={askWidget}><label className="sr-only" htmlFor="mini-widget-question">Ask a question</label><input id="mini-widget-question" value={question} onChange={(event) => setQuestion(event.target.value)} /><button type="submit" aria-label="Ask widget"><Send size={16} aria-hidden="true" /></button></form></div></div>
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="marketing-pricing marketing-cream">
      <div className="marketing-container">
        <SectionHeading description="Same core workflow on both plans. Allowances differ; billing state comes from the connected backend.">
          Straightforward by design.
        </SectionHeading>
        <div className="pricing-layout">
          {plans.map((plan, index) => (
            <article className={index === 1 ? "marketing-plan is-featured" : "marketing-plan"} key={plan.name}>
              {index === 1 && <span className="plan-ribbon">More room to grow</span>}
              <div className="plan-heading"><h3>{plan.name}</h3><span>{index === 0 ? "For a small team" : "For a growing support loop"}</span></div>
              <p className="plan-description">{plan.description}</p>
              <div className="plan-price"><strong>{plan.price}</strong><span>/ month</span></div>
              <Link className={index === 1 ? "button button-primary" : "button button-secondary"} href={`/auth/sign-up?plan=${plan.name.toLowerCase()}`}>Start with {plan.name} <ArrowUpRight size={16} aria-hidden="true" /></Link>
              <ul className="plan-features">{plan.features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}</ul>
            </article>
          ))}
          <aside className="workspace-invite"><Mark size={31} /><h3>Start with a real workspace.</h3><p>Import your own knowledge, inspect the evidence, and make the first comparison before you connect customers.</p><Link className="text-arrow" href="/app">Open your workspace <ArrowRight size={16} aria-hidden="true" /></Link><small>Proposed launch pricing. Actual billing state comes from your connected backend.</small></aside>
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  return (
    <section id="faq" className="marketing-faq marketing-cream">
      <div className="marketing-container faq-layout">
        <SectionHeading description="The short version of what Lattice does, where it stops, and how to test it before you publish.">
          A little more clarity.
        </SectionHeading>
        <div className="faq-list">
          {faqs.map(([question, answer], index) => {
            const open = openFaq === index;
            const answerId = `marketing-faq-${index}`;
            return <div className={open ? "faq-row is-open" : "faq-row"} key={question}><h3><button type="button" aria-expanded={open} aria-controls={answerId} onClick={() => setOpenFaq(open ? null : index)}>{question}<ChevronDown size={19} aria-hidden="true" /></button></h3><div id={answerId} hidden={!open}><p>{answer}</p></div></div>;
          })}
        </div>
      </div>
    </section>
  );
}

function ClosingSection() {
  return (
    <section className="marketing-closing">
      <div className="marketing-container closing-layout">
        <Mark size={48} aria-hidden="true" />
        <h2>Fix your support bot&apos;s wrong answers for good.</h2>
        <p>Bring one real question. See the evidence. Decide what should change.</p>
        <div className="closing-actions"><Link className="button button-primary" href="/auth/sign-up">Start with a real workspace <ArrowUpRight size={17} aria-hidden="true" /></Link><Link className="closing-secondary" href="#workflow">See the workflow <ArrowRight size={16} aria-hidden="true" /></Link></div>
      </div>
    </section>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container footer-grid">
        <div className="footer-brand"><Brand /><p>Built on knowledge. Refined by people.</p></div>
        <div className="footer-links"><div><strong>Product</strong><a href="#product">Capabilities</a><a href="#workflow">Workflow</a><a href="#install">Install</a></div><div><strong>Decide</strong><a href="#compare">Compare</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div><div><strong>Access</strong><Link href="/auth/sign-up">Create account</Link><Link href="/auth/sign-in">Sign in</Link><Link href="/app">Open workspace</Link></div></div>
        <div className="footer-legal"><span>Privacy and terms are deployment gates before live customer data is connected.</span><span>Lattice is a working label, not a cleared public brand.</span></div>
      </div>
    </footer>
  );
}

export function Marketing() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
       { rootMargin: "1px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="marketing">
      <MarketingHeader menu={menu} scrolled={scrolled} setMenu={setMenu} />
      <div ref={sentinelRef} className="header-sentinel" aria-hidden="true" />
      <main id="main-content">
        <MarketingHero />
        <CapabilityMarquee />
        <PinnedWorkflow />
        <ImproveDemo />
        <ComparisonSection />
        <InstallSection />
        <PricingSection />
        <FAQSection />
        <ClosingSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
