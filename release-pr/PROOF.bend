# The release PR: the proofs. AI-written. The invariant Inv holds at every state a run of events reaches; L3 and L4
# follow from it.

import Base
import ./SPEC.bend as S
import ./main.bend as M
import ./LAWS.bend as Laws

# ---- Bool and Nat ----------------------------------------------------------------------------------------------------

def disc(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def no0(e: {False{} == True{} : Bool}) -> Empty:
  %e : disc(_)
  Unit{}

def no(-A: Type, e: {False{} == True{} : Bool}) -> A:
  Empty.absurd(A, no0(e))

def lt_irrefl(n: Nat) -> {S.lt(n, n) == False{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      lt_irrefl(p)

def lt_succ(n: Nat) -> {S.lt(n, 1n+n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      lt_succ(p)

def lt_step(a: Nat, b: Nat) -> {S.lt(a, b) == True{} : Bool} -> {S.lt(a, 1n+b) == True{} : Bool}:
  match a b:
    case 0n 0n:
      h => no({S.lt(0n, 1n) == True{} : Bool}, h)
    case 0n 1n+q:
      h => {==}
    case 1n+p 0n:
      h => no({S.lt(1n+p, 1n) == True{} : Bool}, h)
    case 1n+p 1n+q:
      h => lt_step(p, q, h)

def eqn_refl(n: Nat) -> {S.eqn(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      eqn_refl(p)

def meq_refl(m: +Maybe<Nat>) -> {S.meq(m, m) == True{} : Bool}:
  match m:
    case None{}:
      {==}
    case Some{x}:
      eqn_refl(x)

def imp_true(a: Bool) -> {S.implies(a, True{}) == True{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      {==}

# ---- L1, L2: one reconcile -------------------------------------------------------------------------------------------

def Laws.l1_nothing_pending(t, pr):
  match pr:
    case None{}:
      {==}
    case Some{x}:
      {==}

def Laws.l2_reconcile_exact(t, p, pr):
  match p pr:
    case 0n None{}:
      {==}
    case 0n Some{x}:
      {==}
    case 1n+q None{}:
      {==}
    case 1n+q Some{x}:
      {==}

# ---- the invariant ---------------------------------------------------------------------------------------------------

# With no run owed, the open release PR is the one the tip asks for.
def OkPr(owed: Bool, pr: +Maybe<Nat>, tip: Nat, pend: Nat) -> Type:
  match owed:
    case True{}:
      Unit
    case False{}:
      {pr == S.expect(tip, pend) : +Maybe<Nat>}

# A refetched tree is the tip itself, or behind it.
def Behind(t: Nat, p: Nat, tip: Nat, pend: Nat) -> Type:
  Either<({t == tip : Nat} & {p == pend : Nat}), {S.lt(t, tip) == True{} : Bool}>

# With no run owed, a refetched tree is the tip.
def OkFresh(owed: Bool, t: Nat, tip: Nat) -> Type:
  match owed:
    case True{}:
      Unit
    case False{}:
      {t == tip : Nat}

def OkRun(run: S.Run, tip: Nat, pend: Nat, owed: Bool) -> Type:
  match run:
    case S.Idle{}:
      Unit
    case S.Out{}:
      Unit
    case S.Ref{t, p}:
      Behind(t, p, tip, pend) & OkFresh(owed, t, tip)

def Inv(w: S.World) -> Type:
  match w:
    case S.W{tip, pend, pr, run, owed}:
      OkPr(owed, pr, tip, pend) & OkRun(run, tip, pend, owed)

# ---- each event keeps it ---------------------------------------------------------------------------------------------

def behind_merge(+t: Nat, -p: Nat, +tip: Nat, -pend: Nat, -q: Nat, b: Behind(t, p, tip, pend)) -> Behind(t, p, 1n+tip, q):
  match b:
    case Inl{v}:
      (e1, e2) = v
      Inr{(%e1 : {S.lt(t, 1n+_) == True{} : Bool}; lt_succ(t))}
    case Inr{h}:
      Inr{lt_step(t, tip, h)}

def merge_run(run: S.Run, +tip: Nat, -pend: Nat, -q: Nat, -owed: Bool, k: OkRun(run, tip, pend, owed)) -> OkRun(run, 1n+tip, q, True{}):
  match run:
    case S.Idle{}:
      Unit{}
    case S.Out{}:
      Unit{}
    case S.Ref{t, p}:
      (b, f) = k
      (behind_merge(t, p, tip, pend, q, b), Unit{})

def checkout_inv(run: S.Run, -tip: Nat, -pend: Nat, -pr: +Maybe<Nat>, -owed: Bool, i: Inv(S.W{tip, pend, pr, run, owed})) -> Inv(M.on_checkout(run, tip, pend, pr, owed)):
  match run:
    case S.Idle{}:
      (a, b) = i
      (a, Unit{})
    case S.Out{}:
      i
    case S.Ref{t, p}:
      i

def fresh_refl(owed: Bool, -tip: Nat) -> OkFresh(owed, tip, tip):
  match owed:
    case True{}:
      Unit{}
    case False{}:
      {==}

def refetch_inv(run: S.Run, +tip: Nat, -pend: Nat, -pr: +Maybe<Nat>, +owed: Bool, i: Inv(S.W{tip, pend, pr, run, owed})) -> Inv(M.on_refetch(run, tip, pend, pr, owed)):
  match run:
    case S.Idle{}:
      i
    case S.Out{}:
      (a, b) = i
      (a, (Inl{({==}, {==})}, fresh_refl(owed, tip)))
    case S.Ref{t, p}:
      i

def lt_same(+t: Nat, -tip: Nat, f: {t == tip : Nat}) -> {S.lt(t, tip) == False{} : Bool}:
  %f : {S.lt(t, _) == False{} : Bool}
  lt_irrefl(t)

# A tree behind the tip with no run owed contradicts OkFresh.
def behind_owed(owed: Bool, +t: Nat, +tip: Nat, -p: Nat, -pend: Nat, -pr: +Maybe<Nat>, h: {S.lt(t, tip) == True{} : Bool}, f: OkFresh(owed, t, tip)) -> OkPr(owed, M.reconcile(t, p, pr), tip, pend):
  match owed:
    case True{}:
      Unit{}
    case False{}:
      x = lt_same(t, tip, f)
      no(OkPr(False{}, M.reconcile(t, p, pr), tip, pend), Equal.trans(Bool, False{}, S.lt(t, tip), True{}, Equal.sym(Bool, S.lt(t, tip), False{}, x), h))

def ref_inv(+t: Nat, +p: Nat, +tip: Nat, +pend: Nat, +pr: +Maybe<Nat>, +owed: Bool, b: Behind(t, p, tip, pend), f: OkFresh(owed, t, tip)) -> OkPr(M.settle(S.lt(t, tip), owed), M.reconcile(t, p, pr), tip, pend):
  match b:
    case Inl{v}:
      (e1, e2) = v
      %Equal.sym(Nat, t, tip, e1) : OkPr(M.settle(S.lt(_, tip), owed), M.reconcile(_, p, pr), tip, pend)
      %Equal.sym(Nat, p, pend, e2) : OkPr(M.settle(S.lt(tip, tip), owed), M.reconcile(tip, _, pr), tip, pend)
      %Equal.sym(Bool, S.lt(tip, tip), False{}, lt_irrefl(tip)) : OkPr(M.settle(_, owed), M.reconcile(tip, pend, pr), tip, pend)
      Laws.l2_reconcile_exact(tip, pend, pr)
    case Inr{+h}:
      %Equal.sym(Bool, S.lt(t, tip), True{}, h) : OkPr(M.settle(_, owed), M.reconcile(t, p, pr), tip, pend)
      behind_owed(owed, t, tip, p, pend, pr, h, f)

def reconcile_inv(run: S.Run, +tip: Nat, +pend: Nat, +pr: +Maybe<Nat>, +owed: Bool, i: Inv(S.W{tip, pend, pr, run, owed})) -> Inv(M.on_reconcile(run, tip, pend, pr, owed)):
  match run:
    case S.Idle{}:
      i
    case S.Out{}:
      i
    case S.Ref{+t, +p}:
      (a, k) = i
      (b, f) = k
      (ref_inv(t, p, tip, pend, pr, owed, b, f), Unit{})

def step_inv(w: S.World, e: S.Act, i: Inv(w)) -> Inv(M.step(w, e)):
  match w:
    case S.W{+tip, +pend, +pr, run, +owed}:
      match e:
        case S.Merge{+q, release}:
          (a, k) = i
          (Unit{}, merge_run(run, tip, pend, q, owed, k))
        case S.Checkout{}:
          checkout_inv(run, tip, pend, pr, owed, i)
        case S.Refetch{}:
          refetch_inv(run, tip, pend, pr, owed, i)
        case S.Reconcile{}:
          reconcile_inv(run, tip, pend, pr, owed, i)

def trace_inv(es: +List<S.Act>, +w: S.World, i: Inv(w)) -> Inv(M.run(es, w)):
  match es:
    case Nil{}:
      i
    case Con{+e, rest}:
      trace_inv(rest, M.step(w, e), step_inv(w, e, i))

def init_inv() -> Inv(M.init()):
  ({==}, Unit{})

# ---- L3, L4: what the invariant gives ----------------------------------------------------------------------------------

def settled(x: S.World, i: Inv(x), q: {S.owed_of(x) == False{} : Bool}) -> {S.pr_of(x) == S.expect_of(x) : +Maybe<Nat>}:
  match x:
    case S.W{tip, pend, pr, run, owed}:
      match owed:
        case True{}:
          no({pr == S.expect(tip, pend) : +Maybe<Nat>}, Equal.sym(Bool, True{}, False{}, q))
        case False{}:
          (a, b) = i
          a

def stale_owed(x: S.World, i: Inv(x)) -> {S.implies(S.stale(x), S.owed_of(x)) == True{} : Bool}:
  match x:
    case S.W{+tip, +pend, +pr, run, owed}:
      match owed:
        case True{}:
          imp_true(Bool.not(S.meq(pr, S.expect(tip, pend))))
        case False{}:
          (a, b) = i
          %a : {S.implies(Bool.not(S.meq(pr, _)), False{}) == True{} : Bool}
          %Equal.sym(Bool, S.meq(pr, pr), True{}, meq_refl(pr)) : {S.implies(Bool.not(_), False{}) == True{} : Bool}
          {==}

def Laws.l3_settled_exact(es, q):
  settled(M.run(es, M.init()), trace_inv(es, M.init(), init_inv()), q)

def Laws.l4_stale_owed(es):
  stale_owed(M.run(es, M.init()), trace_inv(es, M.init(), init_inv()))

# ---- L5 to L8: the incident, before and after the fix ------------------------------------------------------------------

def Laws.l5_old_job_reopens():
  {==}

def Laws.l6_fixed_job_closes():
  {==}

def Laws.l7_window_stale():
  {==}

def Laws.l7_window_owed():
  {==}

def Laws.l8_window_closes():
  {==}
