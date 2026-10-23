# Premium features

## The line that decides everything

A freemium desktop tool lives or dies on where the free tier stops. Stop it too
early and nobody reaches the moment the product is good; stop it too late and
nobody pays.

**The free tier must be able to finish a real job.** A creator should be able
to caption a video, style it, burn it in and publish it without paying — and
discover the limit on their *eleventh* video, not their first. What converts is
volume, polish and time, not capability.

That rules out the two obvious crippling tactics. A watermark on a free export
is the cloud tools' move and it is why their reviews are full of people who
felt tricked. A hard feature wall at generation makes the product
undemonstrable. Instead the free tier is complete and the paid tiers remove
friction that only appears at scale.

## Free — the whole pipeline, one file at a time

Import, transcribe with `tiny` through `small`, segment, enhance, edit, style
with all five presets, export SRT, VTT and ASS, burn in at up to 1080p. No
watermark, no account, no time limit, no cue count limit. Batch processing
limited to three files per queue.

This is a complete tool for someone publishing weekly. It is also the entire
argument for the paid tiers: a user who has captioned ten videos knows exactly
which parts of the process they would pay to speed up.

## Creator — the friction tier

For the weekly publisher whose bottleneck is their own time.

**The larger models.** `medium` and `large-v3`, which is the difference between
correcting ten names per episode and correcting one. This is the clearest value
in the product and the easiest to feel.

**Unlimited batch.** Forty lecture recordings overnight rather than fourteen
sessions of three.

**Karaoke captions.** Word-level highlighting, the look that short-form video
has standardised on. The timing data is already in the database; the feature is
a renderer and an ASS emitter.

**Custom style libraries and brand kits.** A channel's fonts, colours and
positions saved as a named kit, applied to any project in one click, and
exportable to a collaborator.

**Platform export presets.** YouTube, TikTok, Instagram, Shorts, Reels: each
with its dimensions, caption style and reading-speed ceiling as a single
choice.

**4K and HEVC rendering**, with hardware encoding on every supported vendor.

**A glossary that learns.** Every correction the user makes in the editor is
offered to the project glossary, and the glossary feeds Whisper's initial
prompt on the next run. By the fifth episode the model knows the show's
vocabulary. This is the feature most likely to produce a testimonial, because
the improvement is visible and feels like the tool paying attention.

## Studio — the team tier

For agencies, in-house video teams and course producers, where the problem is
not generating captions but agreeing on them.

**A shared style library** on a network path, so a team's house style is one
file rather than six people's habits.

**Review and approval.** Per-cue comments, an approved state, and a view of
what changed since the last pass.

**Watch folders.** A directory that processes files as they land, which turns
batch processing from a session into a pipeline.

**Command-line and scriptable invocation**, so this can sit inside an existing
build or publishing workflow.

**A delivery manifest** recording what was produced from which source with
which settings — the document an agency attaches to an invoice and a compliance
team asks for.

**Offline translation** with its published quality evaluation, when it ships.

**Per-seat licensing with a volume price**, because a five-person team will not
buy five individual subscriptions and should not have to.

## Enterprise — the procurement tier

For healthcare, legal, government and education, where "runs offline" is the
requirement that decides whether a tool can be installed.

They are buying three things, none of which is a feature in the usual sense: a
**signed, auditable installer** with a published hash and an SBOM; **offline
licence activation** that works on an air-gapped machine with no phone-home;
and a **written statement of data handling** they can hand to their own
compliance officer — which, for this product, is unusually easy to write
truthfully.

Plus the operational pieces: silent MSI deployment with group policy, a
site-wide licence, a named support contact with a response commitment, and a
six-month notice commitment on breaking changes.

This tier is priced per site and sold by conversation, not by a checkout page.
It will be a small number of customers and a large share of revenue, and the
product needs almost no new code to serve it — which is the argument for
building it early.

## What stays free forever, and why that is a commitment

Three things, stated as a promise because a promise that can be quietly
withdrawn is worth nothing.

**SRT, VTT and ASS export.** Caption files are accessibility. Charging for the
ability to make a video accessible would be indefensible, and it is also how
the product earns the goodwill that sells the other tiers.

**No watermark on any output, at any tier.** Including free.

**Offline operation.** No tier requires a connection to work. Licence checks
happen at activation and then, at most, once a month with a long grace period —
and the Enterprise tier has an entirely offline path.

## How the limits are enforced, honestly

Technical enforcement in a desktop application that must run offline is weak,
and pretending otherwise produces hostile software. A determined user will
bypass any check. The approach that works is to make paying easier than not:

A signed licence file, verified locally against a public key, unlocking
features by claim. No online activation required for Enterprise; a monthly
check with a 30-day grace period for the others. No kill switch — an expired
licence reverts to the free tier with every project intact, because holding a
user's work hostage is how a tool loses an audience permanently.

The models themselves are not gated technically, because they are MIT-licensed
files on the user's disk and a gate would be theatre. `medium` and `large-v3`
are offered, fetched and supported as part of the paid tiers. The honest
proposition is that you are paying for the tool, the presets, the batch
capacity and the support — not for a file you could download yourself.

## Sequencing

Ship free and Creator together: a paid tier with nothing to compare it to
converts nobody. Studio follows once a handful of agencies have asked for the
same three things, which is a better specification than a roadmap. Enterprise
is sold before it is finished, because its requirements come from the first
customer's procurement questionnaire and no amount of guessing improves on
that.
