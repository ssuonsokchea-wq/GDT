# Commercialization

## The position

Every competitor in this category is a cloud service with a desktop skin.
CapCut, Descript, VEED, Submagic, Kapwing: you upload your footage, their
servers transcribe it, you pay per minute or per month, and your unreleased
work sits on someone else's disk.

**SubtitleForge's entire position is the inverse: your footage never leaves
your machine.** That is not a feature in a list. It is the answer to a question
the cloud tools cannot answer, and it is why a hospital, a law firm, a
government department or a creator with an embargoed launch can install this
and cannot install them.

The message is one sentence: *professional captions, generated on your own
computer, in minutes, with nothing uploaded.*

## Who pays, and why

| Segment | Size and reachability | What they pay for | What converts them |
| --- | --- | --- | --- |
| **Independent creators** | Very large, cheap to reach, price-sensitive, high churn | Time: the larger models, batch, karaoke captions, brand kits | A free tier that finishes real work, then volume |
| **Educators and course producers** | Large, reachable through institutions | Batch processing and accuracy on technical vocabulary | A term's backlog cleared overnight |
| **Agencies and post houses** | Medium, expensive to reach, low churn, high value | Team workflow, house style, delivery manifests | One studio seat after their third repeated complaint about a cloud tool's turnaround |
| **Privacy-bound organisations** | Small, slow to reach, very low churn, highest value | Compliance: offline operation they can attest to | Their own procurement questionnaire |
| **Localisation teams** | Medium, adjacent | Translation, when it ships | Not yet addressable; v1.2 |

The creator segment pays the bills early and churns. The privacy segment pays
slowly and never leaves. A business built only on the first is fragile; one
built only on the second starves while it waits. Both, in that order.

## Pricing

| | Price | What it is |
| --- | --- | --- |
| **Free** | — | The whole pipeline, one file at a time, three-file batches, models up to `small`, 1080p burn-in, no watermark |
| **Creator** | $9/month or $79/year, or **$149 once** | `medium` and `large-v3`, unlimited batch, karaoke, brand kits, platform presets, 4K and HEVC |
| **Studio** | $29/seat/month, or $249/seat once | Shared style library, review and approval, watch folders, CLI, delivery manifests |
| **Enterprise** | From $4,000/site/year | Signed installer with SBOM, offline activation, silent deployment, named support, change-notice commitment |

**The perpetual option is deliberate and it is the sharpest competitive
weapon.** A desktop tool that runs offline has no per-minute server cost, so a
subscription is harder to justify to a customer who can see that. Offering
"$149, yours, forever, plus a year of updates" against a competitor's
"$12/month while you keep paying" is a comparison that wins on the first look,
and it attracts exactly the user who distrusts cloud tools in the first place.

Renewals for perpetual licences are optional and priced at 40% of the licence
for another year of updates. Expect a third to renew; treat the rest as paid
word of mouth.

The free tier's three-file batch limit is the one number worth tuning on real
data. It should be the limit a weekly creator never notices and a course author
hits within an hour.

## Unit economics

A desktop application that uses no servers has a cost structure most software
businesses would envy, and it is worth being concrete about it because it
changes what pricing is viable.

Marginal cost per customer: a payment processor's fee, a few megabytes of
bandwidth for the installer, and support. At $79 a year with Stripe at roughly
3%, a 5% monthly support contact rate and twenty minutes per contact, the
gross margin sits above 85% — and unlike a cloud captioning service, a customer
who transcribes two hundred hours a month costs nothing more than one who
transcribes two.

That asymmetry is the business case. The cloud competitors must meter usage
because usage is their cost. We can offer unlimited transcription honestly,
and "unlimited" is both true and unmatchable.

Fixed costs are code signing (roughly $400 a year for an EV certificate), a
website, and engineering. The break-even is therefore low enough that this is a
viable two-person business at a few hundred customers, and a viable company at
a few thousand.

## Going to market

**Months one to three — be findable by the people already looking.**

The highest-intent audience is already searching "offline subtitle generator",
"whisper gui windows", "subtitle tool no upload", "local transcription privacy".
There are perhaps twenty such queries and they are almost uncontested, because
the incumbents optimise for "ai subtitle generator" where the competition is
brutal. Ten pages that answer those twenty queries honestly — including where
the tool is *not* the right choice — will outrank a marketing page for years.

The communities where this matters most are r/VideoEditing, r/LocalLLaMA,
r/selfhosted, r/editors, and Hacker News. All four are hostile to marketing and
receptive to a working tool with an honest limits section. Post the benchmark
numbers, including the ones that are unflattering. The audience that rewards
that is precisely the audience that buys.

A thirty-second demonstration carries the product better than any copy: drop a
video in, press one button, watch captions appear, press another, get a styled
burn-in. The absence of a sign-up screen is itself the pitch.

**Months four to nine — earn the professional segment.**

Publish the evaluation corpus and the word error rates per model. Nobody else
in this category publishes accuracy numbers, which makes doing so both
credible and quotable.

Write the compliance page that an organisation's security review needs —
exactly what data goes where, which is a short and pleasant document to write
for this product — and the accessibility page about WCAG and the regional
captioning requirements that make this a purchase rather than a nicety.

Reach educators through institutional pilots: one department, a term's
recordings, a report. University procurement is slow and then enormous.

**Months ten to eighteen — compound.**

Localise the interface, starting with the markets where cloud tools are least
usable: Khmer, Vietnamese, Indonesian, Portuguese, Spanish. Build the
affiliate programme that editing-tutorial channels will actually use. Approach
the hardware vendors — an NVIDIA or Intel developer-blog post about local AI
tooling is free distribution to exactly the right audience.

## The risks worth naming

**The models improve faster than we do, and someone bundles a better one in a
weekend.** This is real and it is why the moat cannot be the model. It has to
be the thirty things around the model: segmentation that reads, a preview that
matches the render, a timeline that behaves, errors that explain themselves,
batch that survives a forty-file queue. Those take months and are invisible in
a feature comparison — which is exactly why they are defensible.

**Apple, Adobe or Google ships offline captioning for free.** Partly already
true, and partly why the professional and privacy segments matter more than the
creator one. A built-in feature will not produce ASS files to a house style, a
delivery manifest, or a compliance attestation.

**FFmpeg licensing forecloses a commercial release.** The mitigation is
cheap and should be done before launch: build FFmpeg from source under LGPL.
Discovering this after shipping is the expensive version. See
[LIBRARIES.md](LIBRARIES.md).

**Support load from GPU configuration.** CUDA, cuBLAS and cuDNN are the single
largest source of support contacts in any local-AI product. The mitigation is
in the code already — CPU always works, the device is detected, the failure
message names the missing library — and the next step is a one-page
troubleshooting guide for the five errors that will account for most of it.

**Piracy.** For a perpetual-licence offline tool, substantial and
unpreventable. The response is to price so that paying is easier than not, keep
the free tier genuinely useful so that most pirates were never customers, and
spend nothing on enforcement that could be spent on the product.

## What success looks like at eighteen months

Ten thousand free installations, a thousand paying customers at a mix of
subscription and perpetual, five Studio teams and two Enterprise sites. That is
roughly $180,000 a year against costs of perhaps $25,000 plus engineering — a
business that supports two people comfortably and can hire a third.

The leading indicator is not revenue. It is the share of exports that are
burned video rather than subtitle files: it tells us whether people are
publishing with this tool or merely generating a file in it. We design for that
number rising, and if it does not, the product is a utility rather than a
platform and should be priced as one.
