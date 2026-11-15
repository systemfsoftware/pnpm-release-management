# The release PR: a model of the version job of .github/workflows/release.yml and of `github-release-management pr`.
# LAWS.bend states its laws about step and run. This file is a model, not the code that runs: the job is YAML and the
# decision is TypeScript, and each def below names the source it mirrors.

import Base
import ./SPEC.bend as S

# What `pr` does, from packages/github-release-engine/src/pull-request.workflow.ts (pullRequestCaseOf) and
# pull-request.ts (write, openRequest).
type Outcome is Data:
  Created{}
  Updated{}
  Closed{}
  Vacant{}
  Refused{}

# pullRequestCaseOf, after its two configuration refusals (BodyBad, HeadBad), which no event changes:
# - pending > 0: Unversioned, a refusal;
# - a release PR found: Refreshing (write updates it) when the tree has changes, else Closing (write closes it);
# - none found: Vacant, and openRequest creates one when the tree has changes, else stays vacant.
def decide(pending: Nat, found: Bool, changes: Bool) -> Outcome:
  match pending:
    case 1n+q:
      Refused{}
    case 0n:
      match found:
        case True{}:
          match changes:
            case True{}:
              Updated{}
            case False{}:
              Closed{}
        case False{}:
          match changes:
            case True{}:
              Created{}
            case False{}:
              Vacant{}

# `version-management bump` (packages/version-engine/src/bump.ts): with intents it writes the versions and
# changelogs and deletes the intents, so the tree has changes and none pending; with none it writes nothing
# (VersionIdle).
def bumped_pending(p: Nat) -> Nat:
  0n

def bumped_changes(p: Nat) -> Bool:
  match p:
    case 0n:
      False{}
    case 1n+q:
      True{}

def found(pr: +Maybe<Nat>) -> Bool:
  match pr:
    case None{}:
      False{}
    case Some{x}:
      True{}

# The release PR after write: built from the run's tree t when created or updated, gone when closed or vacant, and
# untouched when pr refused, which fails the job.
def apply(o: Outcome, t: Nat, pr: +Maybe<Nat>) -> +Maybe<Nat>:
  match o:
    case Created{}:
      Some{t}
    case Updated{}:
      Some{t}
    case Closed{}:
      None{}
    case Vacant{}:
      None{}
    case Refused{}:
      pr

# bump then pr, on a tree at commit t with p intents pending.
def reconcile(+t: Nat, +p: Nat, +pr: +Maybe<Nat>) -> +Maybe<Nat>:
  apply(decide(bumped_pending(p), found(pr), bumped_changes(p)), t, pr)

def close(release: Bool, pr: +Maybe<Nat>) -> +Maybe<Nat>:
  match release:
    case True{}:
      None{}
    case False{}:
      pr

# A reconcile reads every merge so far only when its tree is the tip; a tree behind the tip leaves a run owed.
def settle(behind: Bool, owed: Bool) -> Bool:
  match behind:
    case True{}:
      owed
    case False{}:
      False{}

def on_checkout(run: S.Run, tip: Nat, pend: Nat, pr: +Maybe<Nat>, owed: Bool) -> S.World:
  match run:
    case S.Idle{}:
      S.W{tip, pend, pr, S.Out{}, owed}
    case S.Out{}:
      S.W{tip, pend, pr, S.Out{}, owed}
    case S.Ref{t, p}:
      S.W{tip, pend, pr, S.Ref{t, p}, owed}

# The refetch right before bump: `git fetch origin refs/heads/<default>` and a reset onto it.
def on_refetch(run: S.Run, +tip: Nat, +pend: Nat, pr: +Maybe<Nat>, owed: Bool) -> S.World:
  match run:
    case S.Idle{}:
      S.W{tip, pend, pr, S.Idle{}, owed}
    case S.Out{}:
      S.W{tip, pend, pr, S.Ref{tip, pend}, owed}
    case S.Ref{t, p}:
      S.W{tip, pend, pr, S.Ref{t, p}, owed}

def on_reconcile(run: S.Run, +tip: Nat, pend: Nat, +pr: +Maybe<Nat>, owed: Bool) -> S.World:
  match run:
    case S.Idle{}:
      S.W{tip, pend, pr, S.Idle{}, owed}
    case S.Out{}:
      S.W{tip, pend, pr, S.Out{}, owed}
    case S.Ref{+t, +p}:
      S.W{tip, pend, reconcile(t, p, pr), S.Idle{}, settle(S.lt(t, tip), owed)}

# One event. A merge leaves a run owed: the push it makes starts a release run, which the callers' concurrency
# group queues behind the running one, and a newer queued run replaces an older one. Either way a run that
# refetches after the merge is still to come, so owed is a flag, not a count.
def step(w: S.World, e: S.Act) -> S.World:
  match w:
    case S.W{tip, pend, pr, run, owed}:
      match e:
        case S.Merge{p, release}:
          S.W{1n+tip, p, close(release, pr), run, True{}}
        case S.Checkout{}:
          on_checkout(run, tip, pend, pr, owed)
        case S.Refetch{}:
          on_refetch(run, tip, pend, pr, owed)
        case S.Reconcile{}:
          on_reconcile(run, tip, pend, pr, owed)

def run(es: +List<S.Act>, w: S.World) -> S.World:
  match es:
    case Nil{}:
      w
    case Con{e, rest}:
      run(rest, step(w, e))

def init() -> S.World:
  S.W{0n, 0n, None{}, S.Idle{}, False{}}

# ---- the old version job, for the counterexample --------------------------------------------------------------------
# Before the fix the job checked out the event commit (actions/checkout's default) and ran only when the plan, also
# on the event commit, found intents pending there (phase=version). ORun{t, p} is a whole run on event commit t with
# p intents pending there.

type OldEvent is Data:
  OMerge{p: Nat, release: Bool}
  ORun{t: Nat, p: Nat}

def old_version(p: Nat, +t: Nat, tip: Nat, pend: Nat, +pr: +Maybe<Nat>, run: S.Run, owed: Bool) -> S.World:
  match p:
    case 0n:
      S.W{tip, pend, pr, run, owed}
    case 1n+q:
      S.W{tip, pend, reconcile(t, 1n+q, pr), run, owed}

def old_step(w: S.World, e: OldEvent) -> S.World:
  match w:
    case S.W{tip, pend, pr, run, owed}:
      match e:
        case OMerge{p, release}:
          S.W{1n+tip, p, close(release, pr), run, True{}}
        case ORun{t, p}:
          old_version(p, t, tip, pend, pr, run, owed)

def old_run(es: +List<OldEvent>, w: S.World) -> S.World:
  match es:
    case Nil{}:
      w
    case Con{e, rest}:
      old_run(rest, old_step(w, e))
