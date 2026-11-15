# The release PR: the vocabulary LAWS.bend states its laws in. main.bend models the release workflow with it.
#
# A commit of the default branch is a Nat that grows by one on each merge. The release PR is the one open pull request
# from changeset-release/main. GitHub allows one open pull request per head branch and base, so it is none or one,
# and the commit it was built from names it: Some{t}.

import Base

type World is Data:
  # tip: the default branch's head. pend: the change intents pending at tip. pr: the open release PR, by the commit
  # it was built from. run: where the version job of the running release run is. owed: a merge happened that no
  # finished reconcile has read yet, so a run that will read it is still to come.
  W{tip: Nat, pend: Nat, pr: +Maybe<Nat>, run: Run, owed: Bool}

type Run is Data:
  # Idle: no version job is mid-run. Out: it has checked out a tree. Ref: it refetched the default branch, reading
  # commit t with p pending intents.
  Idle{}
  Out{}
  Ref{t: Nat, p: Nat}

type Act is Data:
  # Merge: a pull request merges to the default branch and leaves p intents pending there; release says it was the
  # release PR, which GitHub then closes. Checkout, Refetch and Reconcile are the version job's steps, in order.
  Merge{p: Nat, release: Bool}
  Checkout{}
  Refetch{}
  Reconcile{}

# The release PR the default branch asks for: none when nothing is pending, else one built from the tip.
def expect(t: Nat, p: Nat) -> +Maybe<Nat>:
  match p:
    case 0n:
      None{}
    case 1n+q:
      Some{t}

def lt(a: Nat, b: Nat) -> Bool:
  match a b:
    case 0n 0n:
      False{}
    case 0n 1n+q:
      True{}
    case 1n+p 0n:
      False{}
    case 1n+p 1n+q:
      lt(p, q)

def eqn(a: Nat, b: Nat) -> Bool:
  match a b:
    case 0n 0n:
      True{}
    case 0n 1n+q:
      False{}
    case 1n+p 0n:
      False{}
    case 1n+p 1n+q:
      eqn(p, q)

def meq(a: +Maybe<Nat>, b: +Maybe<Nat>) -> Bool:
  match a b:
    case None{} None{}:
      True{}
    case None{} Some{y}:
      False{}
    case Some{x} None{}:
      False{}
    case Some{x} Some{y}:
      eqn(x, y)

def implies(a: Bool, b: Bool) -> Bool:
  match a:
    case False{}:
      True{}
    case True{}:
      b

def owed_of(w: World) -> Bool:
  match w:
    case W{tip, pend, pr, run, owed}:
      owed

def pr_of(w: World) -> +Maybe<Nat>:
  match w:
    case W{tip, pend, pr, run, owed}:
      pr

def expect_of(w: World) -> +Maybe<Nat>:
  match w:
    case W{tip, pend, pr, run, owed}:
      expect(tip, pend)

# A stale release PR: the open release PR is not the one the default branch asks for.
def stale(w: World) -> Bool:
  match w:
    case W{tip, +pend, pr, run, owed}:
      Bool.not(meq(pr, expect(tip, pend)))
