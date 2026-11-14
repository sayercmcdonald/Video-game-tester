'use strict';
const { html, raw, money } = require('../lib/util');
const { page } = require('./layout');
const { flat, annotatedFlat } = require('./flats');
const catalog = require('../services/catalog');

const PROCESS = [
  ['Inquiry', 'You send the project details through our intake form. We read every submission ourselves.'],
  ['Scope & quote', 'We confirm the brief with you and issue a written quote with a fixed scope and price.'],
  ['Deposit', 'Accepting the quote raises a deposit invoice. Work is scheduled once it is paid.'],
  ['Development', 'Design, technical documentation and visualisation, with progress shared in your client portal.'],
  ['Review', 'You review the work and request revisions within the rounds agreed in the quote.'],
  ['Delivery', 'After the final payment, reviewed files are released for handoff to your factory.'],
];

/** Studio-initiated studies. None of this is client work and the pages say so. */
const STUDIES = [
  { no: '01', garment: 'overshirt', title: 'Field Overshirt', category: 'Shirting / outerwear',
    text: 'A boxy overshirt with twin flapped chest pockets, a two-piece collar and a box-pleated back yoke. Drawn to explore how much construction detail a flat needs before a factory stops asking questions.',
    spec: [['Chest, 2.5 cm below armhole', '61.0'], ['Body length, HPS', '74.0'], ['Sleeve length', '63.0'], ['Cuff opening', '12.5']] },
  { no: '02', garment: 'trouser', title: 'Pleated Wide Trouser', category: 'Trousers',
    text: 'A high-rise trouser with a single forward pleat, slant pockets and a deep hem. A study in proportion: rise, thigh and hem are balanced so the leg falls clean without a break.',
    spec: [['Waist, relaxed', '41.0'], ['Front rise', '33.5'], ['Thigh, 2.5 cm below crotch', '36.0'], ['Hem opening', '27.0']] },
  { no: '03', garment: 'coat', title: 'Long Mac', category: 'Outerwear',
    text: 'A single-breasted mac with a notched collar, angled welt pockets, a back storm flap and a centre vent. The drawing set resolves how the collar, facing and vent are built.',
    spec: [['Chest', '63.0'], ['Body length, HPS', '112.0'], ['Shoulder width', '49.0'], ['Vent length', '34.0']] },
  { no: '04', garment: 'tee', title: 'Heavyweight Tee', category: 'Jersey',
    text: 'A dropped-shoulder tee with a deep rib neck and a taped back neck. The simplest garment in the set, and the least forgiving: every centimetre shows.',
    spec: [['Chest', '58.0'], ['Body length, HPS', '70.0'], ['Sleeve length', '24.0'], ['Neck rib height', '2.5']] },
];

const conceptTag = raw('<span class="tag">Concept study · not client work</span>');

function home(ctx) {
  return page(ctx, {
    dark: true,
    path: '/',
    body: html`
<section class="hero">
  <div class="hero__copy">
    <p class="label label--light hero__kicker">Fashion design &amp; development studio</p>
    <h1 class="display display--xl">Garments, <em>engineered</em> before they are made.</h1>
    <p class="lede lede--light">Sunday Division takes a garment from first idea to factory-ready files: design, technical flats and tech packs, 3D visualisation, and the imagery to launch it.</p>
    <div class="hero__actions">
      <a class="btn btn--light" href="/start">Start a Project</a>
      <a class="link link--light" href="/services">See services and pricing</a>
    </div>
  </div>
  <figure class="hero__figure">
    ${annotatedFlat()}
    <figcaption class="label label--light">Study 01 — Field Overshirt · points of measure in cm · concept study</figcaption>
  </figure>
</section>

<section class="section">
  <div class="section__head reveal">
    <p class="label">What we do</p>
    <h2 class="display display--l">Four services, one continuous line from sketch to spec.</h2>
  </div>
  <ol class="services-list">
    ${catalog.SERVICES.map((s, i) => html`<li class="services-list__item reveal">
      <span class="num">0${i + 1}</span>
      <h3>${s.name}</h3>
      <p>${s.text}</p>
    </li>`)}
  </ol>
</section>

<section class="section section--bone">
  <div class="split">
    <div class="reveal">
      <p class="label">How we work</p>
      <h2 class="display display--l">AI does the organising. People make the decisions.</h2>
    </div>
    <div class="prose reveal">
      <p>We use AI to move faster on the work around the work: organising briefs, preparing drafts, keeping projects on schedule. That time goes back into design and technical accuracy.</p>
      <p>Every quote, every status update and every file you receive is reviewed and approved by a person before it reaches you. Technical deliverables are checked by a technical designer before release.</p>
      <p><a class="link" href="/about">More about the studio</a></p>
    </div>
  </div>
</section>

<section class="section">
  <div class="section__head reveal">
    <p class="label">Engagements</p>
    <h2 class="display display--l">Three ways to begin.</h2>
  </div>
  <div class="packages">
    ${catalog.PACKAGES.map((p) => html`<article class="package reveal">
      <p class="label">${p.typicalTimeline}</p>
      <h3 class="display display--m">${p.name}</h3>
      <p class="package__price">from ${money(p.fromCents).replace('.00', '')}</p>
      <p>${p.summary}</p>
      <a class="link" href="/services#${p.id}">What is included</a>
    </article>`)}
  </div>
</section>

<section class="section section--ink">
  <div class="section__head reveal">
    <p class="label label--light">Process</p>
    <h2 class="display display--l">A fixed scope, a deposit, then the work.</h2>
  </div>
  <ol class="process">
    ${PROCESS.map(([name, text], i) => html`<li class="reveal"><span class="num">0${i + 1}</span><h3>${name}</h3><p>${text}</p></li>`)}
  </ol>
</section>

<section class="section">
  <div class="section__head section__head--row reveal">
    <div><p class="label">Studio work</p><h2 class="display display--l">Concept studies.</h2></div>
    <a class="link" href="/portfolio">View all studies</a>
  </div>
  <div class="study-grid">
    ${STUDIES.slice(0, 3).map((s) => html`<a class="study-card reveal" href="/portfolio#study-${s.no}">
      <div class="study-card__art">${flat(s.garment, 'front', { title: `${s.title}, front view` })}</div>
      <p class="label">Study ${s.no} · ${s.category}</p>
      <h3>${s.title}</h3>
      ${conceptTag}
    </a>`)}
  </div>
</section>

${cta()}`,
  });
}

function cta() {
  return html`<section class="section section--cta">
  <div class="reveal">
    <p class="label">Start</p>
    <h2 class="display display--xl">Tell us what you are making.</h2>
    <p class="lede">The intake form takes about five minutes. You will hear back from a person at the studio with questions or a quote.</p>
    <a class="btn" href="/start">Start a Project</a>
  </div>
</section>`;
}

function services(ctx) {
  return page(ctx, {
    title: 'Services',
    path: '/services',
    description: 'Fashion design, technical flats and tech packs, 3D garment visualisation and product imagery. Packages from $750.',
    body: html`
<section class="section section--intro">
  <p class="label">Services</p>
  <h1 class="display display--xl">Design and development, <em>documented properly</em>.</h1>
  <p class="lede">We work on the part of fashion that happens before production: deciding what the garment is, and describing it precisely enough that someone else can make it.</p>
</section>

<section class="section section--tight">
  <ol class="services-list services-list--wide">
    ${catalog.SERVICES.map((s, i) => html`<li class="services-list__item reveal"><span class="num">0${i + 1}</span><h2>${s.name}</h2><p>${s.text}</p></li>`)}
  </ol>
</section>

<section class="section section--bone">
  <div class="section__head reveal">
    <p class="label">Packages</p>
    <h2 class="display display--l">Starting points, priced openly.</h2>
    <p class="lede">These are introductory prices. Your quote is fixed in writing before any work begins, based on the garment and what you need delivered.</p>
  </div>
  <div class="package-rows">
    ${catalog.PACKAGES.map((p) => html`<article class="package-row reveal" id="${p.id}">
      <div>
        <h3 class="display display--m">${p.name}</h3>
        <p class="package__price">from ${money(p.fromCents).replace('.00', '')}</p>
        <p class="label">Typical timeline · ${p.typicalTimeline}</p>
      </div>
      <div>
        <p class="package-row__summary">${p.summary}</p>
        <p class="label">Typically includes</p>
        <ul class="ticks">${p.includes.map((i) => html`<li>${i}</li>`)}</ul>
        <a class="btn btn--small" href="/start?package=${p.id}">Enquire about ${p.name}</a>
      </div>
    </article>`)}
  </div>
</section>

<section class="section">
  <div class="split">
    <div class="reveal">
      <p class="label">Good to know</p>
      <h2 class="display display--l">What is not included.</h2>
    </div>
    <div class="prose reveal">
      <p>We do not manufacture, sample or source, and we do not manage physical production. Our files are prepared so you can take them to the factory or sourcing partner of your choice.</p>
      <p>Payment is in two parts: a deposit when you accept the quote, and the balance before final files are released. Payments are taken through a secure hosted checkout; we never see or store your card details.</p>
    </div>
  </div>
</section>
${cta()}`,
  });
}

function portfolio(ctx) {
  return page(ctx, {
    title: 'Portfolio',
    path: '/portfolio',
    description: 'Studio-initiated concept studies from Sunday Division: technical flats and measurement specifications.',
    body: html`
<section class="section section--intro">
  <p class="label">Portfolio</p>
  <h1 class="display display--xl">Concept studies.</h1>
  <p class="lede">We are a new studio. Everything on this page is studio-initiated concept work, made to show how we draw and specify a garment. None of it was commissioned by, or produced for, a client. Client projects will appear here only with permission.</p>
</section>
${STUDIES.map((s) => html`<section class="study" id="study-${s.no}">
  <div class="study__meta reveal">
    <p class="label">Study ${s.no} · ${s.category}</p>
    <h2 class="display display--l">${s.title}</h2>
    ${conceptTag}
    <p>${s.text}</p>
    <table class="spec">
      <caption class="label">Points of measure — base size, cm</caption>
      <tbody>${s.spec.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody>
    </table>
  </div>
  <div class="study__art reveal">
    <figure>${flat(s.garment, 'front', { title: `${s.title}, front view` })}<figcaption class="label">Front</figcaption></figure>
    <figure>${flat(s.garment, 'back', { title: `${s.title}, back view` })}<figcaption class="label">Back</figcaption></figure>
  </div>
</section>`)}
${cta()}`,
  });
}

function about(ctx) {
  return page(ctx, {
    title: 'About',
    path: '/about',
    body: html`
<section class="section section--intro">
  <p class="label">About</p>
  <h1 class="display display--xl">A design studio built like an <em>engineering</em> practice.</h1>
  <p class="lede">Sunday Division exists for founders, designers and brands who have a garment in mind and need it resolved: designed, drawn, measured and specified so it can be made well.</p>
</section>

<section class="section section--bone">
  <div class="split">
    <div class="reveal"><p class="label">Principles</p><h2 class="display display--l">How we think about the work.</h2></div>
    <ol class="principles">
      <li class="reveal"><span class="num">01</span><h3>Precision is a design decision.</h3><p>A garment is only as good as its description. We treat the flat, the measurement spec and the construction note as part of the design, not paperwork after it.</p></li>
      <li class="reveal"><span class="num">02</span><h3>Software should carry the routine.</h3><p>We use AI for organising, drafting and tracking, so that people spend their time on proportion, fit and construction.</p></li>
      <li class="reveal"><span class="num">03</span><h3>A person signs off.</h3><p>Nothing reaches a client without human review. Quotes, updates and technical files are each approved by someone accountable for them.</p></li>
      <li class="reveal"><span class="num">04</span><h3>Say what we do not do.</h3><p>We design and develop. We do not manufacture. We would rather hand over excellent files than promise a supply chain we do not run.</p></li>
    </ol>
  </div>
</section>

<section class="section">
  <div class="split">
    <div class="reveal"><p class="label">Tools</p><h2 class="display display--l">What we are building.</h2></div>
    <div class="prose reveal">
      <p>Alongside the studio, we are developing two independent software products: <strong>INDEX</strong>, for AI-native garment engineering, and <strong>FORM</strong>, for creative production.</p>
      <p>Both are in development. Until each one is reliable enough to meet our own standard, the work it will eventually assist is produced and reviewed by human designers. When we do use them on a project, their output goes through the same review as everything else.</p>
    </div>
  </div>
</section>
${cta()}`,
  });
}

// ── Forms ────────────────────────────────────────────────────────────────────
const err = (errors, key) => (errors[key] ? html`<p class="field__error" id="err-${key}">${errors[key]}</p>` : '');
const invalid = (errors, key) => (errors[key] ? raw(`aria-invalid="true" aria-describedby="err-${key}"`) : '');

function field({ name, label, values, errors, type = 'text', required = false, hint = '', autocomplete = '', maxlength = 200 }) {
  return html`<div class="field">
    <label for="f-${name}">${label}${required ? '' : html` <span class="optional">optional</span>`}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${values[name] || ''}" maxlength="${maxlength}"
      ${required ? raw('required') : ''} ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ''} ${invalid(errors, name)}>
    ${hint ? html`<p class="field__hint">${hint}</p>` : ''}${err(errors, name)}
  </div>`;
}
function area({ name, label, values, errors, required = false, hint = '', rows = 5, maxlength = 3000 }) {
  return html`<div class="field">
    <label for="f-${name}">${label}${required ? '' : html` <span class="optional">optional</span>`}</label>
    <textarea id="f-${name}" name="${name}" rows="${rows}" maxlength="${maxlength}" ${required ? raw('required') : ''} ${invalid(errors, name)}>${values[name] || ''}</textarea>
    ${hint ? html`<p class="field__hint">${hint}</p>` : ''}${err(errors, name)}
  </div>`;
}
function select({ name, label, values, errors, options, placeholder }) {
  return html`<div class="field">
    <label for="f-${name}">${label}</label>
    <select id="f-${name}" name="${name}" required ${invalid(errors, name)}>
      <option value="">${placeholder}</option>
      ${options.map((o) => html`<option value="${o}" ${values[name] === o ? raw('selected') : ''}>${o}</option>`)}
    </select>${err(errors, name)}
  </div>`;
}

function start(ctx, { values = {}, errors = {} } = {}) {
  const hasErrors = Object.keys(errors).length > 0;
  const chosen = new Set(values.deliverables || []);
  return page(ctx, {
    title: 'Start a Project',
    path: '/start',
    description: 'Tell Sunday Division about your garment or collection and receive a scoped quote.',
    body: html`
<section class="section section--intro">
  <p class="label">Start a Project</p>
  <h1 class="display display--xl">Tell us what you are making.</h1>
  <p class="lede">Share as much as you have. Rough is fine. A person at the studio reads every submission and replies with questions or a quote.</p>
</section>
<section class="section section--tight">
<form class="form" method="post" action="/start" enctype="multipart/form-data" novalidate data-intake>
  ${hasErrors ? html`<div class="form__alert" role="alert"><strong>Please check the highlighted fields.</strong> ${errors._form || ''} If you attached files, attach them again before sending.</div>` : ''}
  <div class="hp" aria-hidden="true"><label>Leave this field empty <input type="text" name="company_url" tabindex="-1" autocomplete="off"></label></div>

  <fieldset class="form__section">
    <legend><span class="num">01</span> You</legend>
    <div class="form__grid">
      ${field({ name: 'brand_name', label: 'Brand name', values, errors, required: true, hint: 'A working name is fine.', autocomplete: 'organization', maxlength: 120 })}
      ${field({ name: 'contact_name', label: 'Your name', values, errors, required: true, autocomplete: 'name', maxlength: 120 })}
      ${field({ name: 'email', label: 'Email', type: 'email', values, errors, required: true, autocomplete: 'email', maxlength: 254 })}
      ${field({ name: 'phone', label: 'Phone', type: 'tel', values, errors, autocomplete: 'tel', maxlength: 40 })}
      ${field({ name: 'website', label: 'Website or social link', values, errors, maxlength: 200 })}
    </div>
  </fieldset>

  <fieldset class="form__section">
    <legend><span class="num">02</span> The project</legend>
    <div class="form__grid">
      ${select({ name: 'garment_category', label: 'Garment category', values, errors, options: catalog.GARMENT_CATEGORIES, placeholder: 'Choose a category' })}
      <div class="field">
        <label for="f-package_interest">Package you are considering <span class="optional">optional</span></label>
        <select id="f-package_interest" name="package_interest">
          <option value="">Not sure yet</option>
          ${catalog.PACKAGES.map((p) => html`<option value="${p.id}" ${values.package_interest === p.id ? raw('selected') : ''}>${p.name} — from ${money(p.fromCents).replace('.00', '')}</option>`)}
        </select>
      </div>
    </div>
    ${area({ name: 'description', label: 'Project description', values, errors, required: true, rows: 7, maxlength: 5000, hint: 'What is the garment, who is it for, and what stage are you at?' })}
    <div class="field" role="group" aria-labelledby="lbl-deliverables">
      <p class="field__label" id="lbl-deliverables">Requested deliverables</p>
      <div class="checks">
        ${catalog.DELIVERABLE_OPTIONS.map((d) => html`<label class="check"><input type="checkbox" name="deliverables" value="${d.id}" ${chosen.has(d.id) ? raw('checked') : ''}><span>${d.label}</span></label>`)}
      </div>${err(errors, 'deliverables')}
    </div>
  </fieldset>

  <fieldset class="form__section">
    <legend><span class="num">03</span> Specification</legend>
    ${area({ name: 'measurements', label: 'Target measurements and sizing', values, errors, rows: 4, hint: 'Size range, base size, key measurements or a fit reference, if you have them.' })}
    ${area({ name: 'fabric_preferences', label: 'Fabric preferences', values, errors, rows: 4, maxlength: 2000, hint: 'Fabrics, weights, finishes or trims you have in mind.' })}
    <div class="field">
      <label for="f-references">Reference images <span class="optional">optional</span></label>
      <input id="f-references" name="references" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" data-file-input ${invalid(errors, 'references')}>
      <p class="field__hint">Up to 6 files, 8 MB each. JPG, PNG, WebP or PDF.</p>
      <ul class="file-list" data-file-list></ul>${err(errors, 'references')}
    </div>
  </fieldset>

  <fieldset class="form__section">
    <legend><span class="num">04</span> Budget &amp; timeline</legend>
    <div class="form__grid">
      ${select({ name: 'budget', label: 'Budget', values, errors, options: catalog.BUDGET_OPTIONS, placeholder: 'Choose a range' })}
      ${select({ name: 'timeline', label: 'Desired timeline', values, errors, options: catalog.TIMELINE_OPTIONS, placeholder: 'Choose a timeline' })}
    </div>
  </fieldset>

  <div class="form__submit">
    <label class="check"><input type="checkbox" name="consent" value="yes" required ${values.consent ? raw('checked') : ''}><span>I agree that Sunday Division may store these details to respond to my inquiry, as described in the <a class="link" href="/privacy">privacy notice</a>.</span></label>
    ${err(errors, 'consent')}
    <button class="btn" type="submit">Send inquiry</button>
  </div>
</form>
</section>`,
  });
}

function received(ctx, ref) {
  return page(ctx, {
    title: 'Inquiry received',
    path: '/start',
    body: html`<section class="section section--narrow">
  <p class="label">Received</p>
  <h1 class="display display--l">Thank you. Your inquiry is with the studio.</h1>
  ${ref ? html`<p class="lede">Your reference is <strong class="mono">${ref}</strong>. Keep it for your records.</p>` : ''}
  <p>A person at Sunday Division will read your submission and reply by email with questions or a quote. If your project goes ahead, you will receive a private link to your client portal, where you can review your quote, pay securely and download your files.</p>
  <p><a class="link" href="/portfolio">See the studio's concept studies</a></p>
</section>`,
  });
}

function contact(ctx, { values = {}, errors = {}, sent = false } = {}) {
  const email = ctx.app.config.studioEmail;
  return page(ctx, {
    title: 'Contact',
    path: '/contact',
    body: html`
<section class="section section--intro">
  <p class="label">Contact</p>
  <h1 class="display display--xl">Ask us anything.</h1>
  <p class="lede">For a new project, the <a class="link" href="/start">intake form</a> gets you the fastest answer. For everything else, write to us here.</p>
</section>
<section class="section section--tight">
  ${sent ? html`<div class="form__notice" role="status"><strong>Message sent.</strong> Thank you — we will reply by email.</div>` : html`
  <form class="form form--short" method="post" action="/contact" novalidate>
    ${Object.keys(errors).length ? html`<div class="form__alert" role="alert"><strong>Please check the highlighted fields.</strong> ${errors._form || ''}</div>` : ''}
    <div class="hp" aria-hidden="true"><label>Leave this field empty <input type="text" name="company_url" tabindex="-1" autocomplete="off"></label></div>
    <div class="form__grid">
      ${field({ name: 'name', label: 'Your name', values, errors, required: true, autocomplete: 'name', maxlength: 120 })}
      ${field({ name: 'email', label: 'Email', type: 'email', values, errors, required: true, autocomplete: 'email', maxlength: 254 })}
    </div>
    ${area({ name: 'message', label: 'Message', values, errors, required: true, rows: 6, maxlength: 4000 })}
    <div class="form__submit"><button class="btn" type="submit">Send message</button></div>
  </form>`}
  ${email ? html`<p class="contact-direct">Or email <a class="link" href="mailto:${email}">${email}</a></p>` : ''}
</section>`,
  });
}

function portalAccess(ctx, { error = '' } = {}) {
  return page(ctx, {
    title: 'Client Portal',
    path: '/portal',
    body: html`<section class="section section--narrow">
  <p class="label">Client Portal</p>
  <h1 class="display display--l">Your project, in one place.</h1>
  <p class="lede">Review your quote, pay invoices securely, follow progress and download approved files.</p>
  <form class="form form--short" method="post" action="/portal/access">
    ${error ? html`<div class="form__alert" role="alert">${error}</div>` : ''}
    <div class="field">
      <label for="f-key">Access key</label>
      <input id="f-key" name="key" type="password" required autocomplete="off" maxlength="200">
      <p class="field__hint">Your access link and key are sent by the studio when your project is opened. Lost it? <a class="link" href="/contact">Contact us</a> for a new one.</p>
    </div>
    <div class="form__submit"><button class="btn" type="submit">Open portal</button></div>
  </form>
</section>`,
  });
}

function privacy(ctx) {
  return page(ctx, {
    title: 'Privacy',
    path: '/privacy',
    body: html`<section class="section section--narrow prose">
  <p class="label">Privacy notice</p>
  <h1 class="display display--l">How we handle your information.</h1>
  <h2>What we collect</h2>
  <p>When you send an inquiry or message, we store what you enter in the form: your name, brand, contact details, project description, any measurements and preferences, and any files you attach. When you become a client, we also store your quote, invoices, project files and the messages exchanged in your portal.</p>
  <h2>How we use it</h2>
  <p>Only to respond to you, scope and deliver your project, and keep the business records we are required to keep. We do not sell your information or use it for advertising.</p>
  <h2>AI-assisted drafting</h2>
  <p>We may use an AI model, provided by a third-party processor, to help organise project details and prepare internal drafts. Your contact details are not included in what is sent for drafting. A person reviews every draft before anything is sent to you.</p>
  <h2>Payments</h2>
  <p>Payments are processed by our payment provider on their own secure pages. Card details are never sent to or stored on our systems.</p>
  <h2>Storage and access</h2>
  <p>Submissions and files are stored on access-controlled systems and are available only to studio staff and contractors working on your project. This site sets only the cookies needed to keep you signed in; it uses no analytics or advertising trackers.</p>
  <h2>Your choices</h2>
  <p>You can ask us for a copy of your information, to correct it, or to delete it, through the <a class="link" href="/contact">contact page</a>.</p>
</section>`,
  });
}

module.exports = { home, services, portfolio, about, start, received, contact, portalAccess, privacy, STUDIES };
