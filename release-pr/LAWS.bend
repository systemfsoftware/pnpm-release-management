# The release PR: the laws. PROOF.bend proves each one with a def of the same name; neither PROOF.bend nor main.bend
# may change this file or SPEC.bend.
#
# What the proofs assume, and so do not cover:
# - Every merge to the default branch starts a release run, or is followed by one that does. A merge whose push
#   starts no workflow (a `[skip ci]` message, or a push made with GITHUB_TOKEN) leaves a run owed that never comes.
#   A queued run that a newer one replaces is covered: the newer run refetches after both merges.
# - Release runs of one repository do not overlap: the version job's own concurrency group in release.yml.
# - No caller sets `cancel-in-progress: true` on its release workflow, which could stop a version job mid-write.
# - Every pending intent bumps a version, so bump leaves none pending.
# - Every write succeeds. A failed push or API call fails the job, and the next run starts from what is on GitHub.
# - Nobody edits changeset-release/main by hand; the next reconcile overwrites or closes such an edit.

import Base
import ./SPEC.bend as S
import ./main.bend as M

# L1: a reconcile on a tree with nothing pending never leaves a release PR open: pr closes or stays vacant.
law l1_nothing_pending:
  for +t: Nat
  for +pr: +Maybe<Nat>
  {M.reconcile(t, 0n, pr) == None{} : +Maybe<Nat>}

# L2: a reconcile leaves exactly the release PR its tree asks for, whatever was open before.
law l2_reconcile_exact:
  for +t: Nat
  for +p: Nat
  for +pr: +Maybe<Nat>
  {M.reconcile(t, p, pr) == S.expect(t, p) : +Maybe<Nat>}

# L3: once no run is owed, the open release PR is exactly the one the tip asks for: none when nothing is pending,
# else one built from the tip. It holds after every sequence of merges and version-job steps.
law l3_settled_exact:
  for +es: +List<S.Act>
  for q: {S.owed_of(M.run(es, M.init())) == False{} : Bool}
  {S.pr_of(M.run(es, M.init())) == S.expect_of(M.run(es, M.init())) : +Maybe<Nat>}

# L4: a stale release PR implies a run is still owed. Under the first assumption above, that run comes and refetches
# after the merge that made the PR stale.
law l4_stale_owed:
  for +es: +List<S.Act>
  {S.implies(S.stale(M.run(es, M.init())), S.owed_of(M.run(es, M.init()))) == True{} : Bool}

# L5: the old job reproduces the incident. A release PR is open from commit 1. #19 merges (commit 2, two intents)
# and starts run A; release PR #30 merges (commit 3, nothing pending) and starts run B. Run A versions its event
# commit 2 and reopens a release PR from it; run B, in phase=release, never reconciles. Nothing is pending, and a
# release PR stays open.
law l5_old_job_reopens:
  {S.stale(M.old_run([M.OMerge{1n, False{}}, M.ORun{1n, 1n}, M.OMerge{2n, False{}}, M.OMerge{0n, True{}}, M.ORun{2n, 2n}, M.ORun{3n, 0n}], M.init())) == True{} : Bool}

# L6: the fixed job on the incident's order of events leaves no release PR open.
law l6_fixed_job_closes:
  {S.pr_of(M.run([S.Merge{1n, False{}}, S.Checkout{}, S.Refetch{}, S.Reconcile{}, S.Merge{2n, False{}}, S.Merge{0n, True{}}, S.Checkout{}, S.Refetch{}, S.Reconcile{}, S.Checkout{}, S.Refetch{}, S.Reconcile{}], M.init())) == None{} : +Maybe<Nat>}

# L7: the window the fix leaves. Release PR #30 merges between a run's refetch and its reconcile, so that run
# reopens a stale release PR, and a run is owed.
law l7_window_stale:
  {S.stale(M.run([S.Merge{1n, False{}}, S.Checkout{}, S.Refetch{}, S.Reconcile{}, S.Merge{2n, False{}}, S.Checkout{}, S.Refetch{}, S.Merge{0n, True{}}, S.Reconcile{}], M.init())) == True{} : Bool}

law l7_window_owed:
  {S.owed_of(M.run([S.Merge{1n, False{}}, S.Checkout{}, S.Refetch{}, S.Reconcile{}, S.Merge{2n, False{}}, S.Checkout{}, S.Refetch{}, S.Merge{0n, True{}}, S.Reconcile{}], M.init())) == True{} : Bool}

# L8: the owed run closes it.
law l8_window_closes:
  {S.pr_of(M.run([S.Merge{1n, False{}}, S.Checkout{}, S.Refetch{}, S.Reconcile{}, S.Merge{2n, False{}}, S.Checkout{}, S.Refetch{}, S.Merge{0n, True{}}, S.Reconcile{}, S.Checkout{}, S.Refetch{}, S.Reconcile{}], M.init())) == None{} : +Maybe<Nat>}
