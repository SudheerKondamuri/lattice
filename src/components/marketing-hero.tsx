import {
  ArrowUpRight,
  Check,
  GitBranch,
  MessageCircle,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Badge, SourceIcon } from "./ui";
import { Mark } from "./brand";

function CardHeader({
  eyebrow,
  status,
}: {
  eyebrow: string;
  status?: { label: string; tone: "green" | "amber" | "red" | "neutral" };
}) {
  return (
    <div className="hero-card-header">
      <span className="hero-card-label">{eyebrow}</span>
      {status && <Badge tone={status.tone}>{status.label}</Badge>}
    </div>
  );
}

function EvidenceCard() {
  return (
    <article className="hero-card hero-card-evidence">
      <div className="hero-card-header">
        <span className="hero-card-label">Current turn / evidence</span>
        <span className="hero-status-stage">
          <Badge tone="red">Needs correction</Badge>
          <Badge tone="green">Grounded</Badge>
        </span>
      </div>
      <div className="hero-card-question">
        <span className="hero-question-mark">?</span>
        <p>Can I export on the Starter plan?</p>
      </div>
      <div className="hero-improve-slot">
        <span className="hero-improve-action">
          Improve this answer <ArrowUpRight size={13} />
        </span>
      </div>
      <div className="hero-answer-state">
        <div className="hero-answer hero-answer-wrong">
          <div className="hero-answer-agent">
            <span className="hero-mini-mark">
              <Mark size={14} />
            </span>
            <span>Draft answer</span>
          </div>
          <p>No. Exports are available on the Growth plan.</p>
        </div>
        <div className="hero-answer hero-answer-correct">
          <div className="hero-answer-agent">
            <span className="hero-mini-mark">
              <Mark size={14} />
            </span>
            <span>Support answer</span>
          </div>
          <p>
            Yes. Starter includes <strong>1,000 rows per export.</strong> Open
            Settings → Workspace → Export data.
          </p>
        </div>
      </div>
      <div className="hero-source-snippet">
        <div className="hero-source-heading">
          <span className="hero-source-icon">
            <SourceIcon kind="website" size={14} />
          </span>
          <span>
            <strong>Plans &amp; exports</strong>
            <small>Source v04 · section 3</small>
          </span>
          <Search size={14} />
        </div>
        <p>
          Starter includes <mark>1,000 rows per export.</mark>
        </p>
      </div>
      <div className="hero-card-footer">
        <span>
          <ShieldCheck size={13} /> Evidence drawer open
        </span>
        <span>Source v04</span>
      </div>
    </article>
  );
}

function ReleaseCard() {
  return (
    <article className="hero-card hero-card-release">
      <CardHeader eyebrow="Release diff / next publish" />
      <div className="release-state-viewport">
        <div className="release-state release-state-draft">
          <div className="release-state-heading">
            <div className="release-card-title">
              <GitBranch size={17} />
              <strong>Release 04</strong>
            </div>
            <Badge tone="amber">Draft</Badge>
          </div>
          <div className="release-diff-list">
            <div>
              <span className="diff-add">+</span>
              <span>Plans &amp; exports · v04</span>
            </div>
            <div>
              <span className="diff-add">+</span>
              <span>Starter limits · approved</span>
            </div>
            <div>
              <span className="diff-remove">−</span>
              <span>FAQ export answer · v02</span>
            </div>
          </div>
          <div className="release-card-note">
            <span className="hero-live-dot" />
            Publication waits for your review.
          </div>
        </div>
        <div className="release-state release-state-published">
          <div className="release-state-heading">
            <div className="release-card-title">
              <Check size={17} />
              <strong>Release 04</strong>
            </div>
            <Badge tone="green">Published</Badge>
          </div>
          <p className="release-published-copy">
            Visitors now answer from the reviewed release.
          </p>
          <div className="release-card-note release-card-note-published">
            <Check size={14} />
            Pointer updated. History retained.
          </div>
        </div>
      </div>
    </article>
  );
}

function CheckCard() {
  return (
    <article className="hero-card hero-card-checks">
      <CardHeader eyebrow="Regression checks" />
      <div className="check-card-states">
        <div className="check-card-state check-card-state-review">
          <div className="check-state-heading">
            <div className="check-card-title">
              <span className="check-card-icon check-card-icon-review">
                <MessageCircle size={15} />
              </span>
              <span>
                <strong>Reviewing the answer</strong>
                <small>Owner-approved cases</small>
              </span>
            </div>
            <Badge tone="amber">Review</Badge>
          </div>
          <div className="check-list">
            <div>
              <MessageCircle size={13} />
              <span>Export limits</span>
              <b>REVIEW</b>
            </div>
            <div>
              <MessageCircle size={13} />
              <span>Refund window</span>
              <b>REVIEW</b>
            </div>
            <div>
              <MessageCircle size={13} />
              <span>Unsupported question</span>
              <b>HANDOFF</b>
            </div>
          </div>
        </div>
        <div className="check-card-state check-card-state-passed">
          <div className="check-state-heading">
            <div className="check-card-title">
              <span className="check-card-icon">
                <Check size={15} />
              </span>
              <span>
                <strong>Regression checks passed</strong>
                <small>Ready for publication</small>
              </span>
            </div>
            <Badge tone="green">Passed</Badge>
          </div>
          <div className="check-list">
            <div>
              <Check size={13} />
              <span>Export limits</span>
              <b>PASS</b>
            </div>
            <div>
              <Check size={13} />
              <span>Refund window</span>
              <b>PASS</b>
            </div>
            <div>
              <Check size={13} />
              <span>Unsupported question</span>
              <b>HANDOFF</b>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function WidgetCard() {
  return (
    <article className="hero-card hero-card-widget">
      <div className="hero-card-header">
        <span className="hero-card-label">Public widget / preview</span>
        <span className="widget-status-stage" aria-label="Widget release state">
          <Badge tone="amber">draft</Badge>
          <Badge tone="green">published</Badge>
        </span>
      </div>
      <div className="widget-card-topline">
        <span className="hero-widget-avatar">
          <Mark size={15} />
        </span>
        <span>
          <strong>Lattice support</strong>
          <small>Grounded in your knowledge</small>
        </span>
        <span className="hero-online-dot" />
      </div>
      <div className="widget-message widget-message-user">
        Can I export on Starter?
      </div>
      <div className="widget-answer-stage">
        <div className="widget-message widget-message-agent widget-message-agent-wrong">
          <p>No. Exports are available on the Growth plan.</p>
        </div>
        <div className="widget-message widget-message-agent widget-message-agent-correct">
          <p>Yes — Starter includes 1,000 rows per export.</p>
          <span className="widget-citation">
            <span>[01]</span> Plans &amp; exports <ArrowUpRight size={11} />
          </span>
        </div>
      </div>
      <div className="widget-card-footer">
        <span>Ask a question</span>
        <ArrowUpRight size={13} />
      </div>
    </article>
  );
}

function RollbackCard() {
  return (
    <article className="hero-card hero-card-rollback">
      <CardHeader
        eyebrow="Rollback / release 03"
        status={{ label: "review", tone: "red" }}
      />
      <div className="rollback-card-icon">
        <RotateCcw size={17} />
      </div>
      <strong>Keep the current visitor release?</strong>
      <p>Rollback changes the pointer. Deleted knowledge stays ineligible.</p>
      <div className="rollback-card-footer">
        <span>Review rollback</span>
        <ArrowUpRight size={13} />
      </div>
    </article>
  );
}

export function MarketingHero() {
  return (
    <section className="hero">
      <div className="hero-inner section-container">
        <div className="hero-copy">
          <h1>
            <span>Support that</span>
            <span>shows its</span>
            <span>work.</span>
          </h1>
          <p>
            Import the knowledge you trust. Inspect every passage. Test the
            change before customers see it.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/app">
              Open workspace <ArrowUpRight size={17} />
            </Link>
            <a className="quiet-link" href="#workflow">
              See the workflow
            </a>
          </div>
        </div>
        <div
          className="hero-cluster-stage"
          aria-label="Illustrative Lattice product states"
        >
          <div className="hero-cluster">
            <div className="hero-cluster-backdrop" aria-hidden="true">
              <div className="hero-backdrop-line hero-backdrop-line-one" />
              <div className="hero-backdrop-line hero-backdrop-line-two" />
            </div>
            <EvidenceCard />
            <ReleaseCard />
            <CheckCard />
            <WidgetCard />
            <RollbackCard />
          </div>
          <div className="hero-cluster-caption">
            <span className="hero-cluster-caption-label">
              <Mark size={17} /> Illustrative workspace states
            </span>
            <ol className="hero-step-indicator" aria-label="Support correction workflow">
              <li>Wrong answer</li>
              <li>Fix</li>
              <li>Check</li>
              <li>Publish</li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
