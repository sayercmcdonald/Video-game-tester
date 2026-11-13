'use strict';
/**
 * The studio's public offer. Single source of truth for the website, the intake form,
 * quote drafting and task templates. Prices are introductory and meant to be tested.
 */
const PACKAGES = [
  {
    id: 'concept',
    name: 'Concept',
    fromCents: 75000,
    summary: 'Direction for a single garment or a small idea, before you commit to development.',
    typicalTimeline: '1–2 weeks',
    includes: [
      'Creative direction and reference board',
      'Design sketches for one garment, with options',
      'Colour, fabric and trim direction',
      'One round of revisions',
    ],
  },
  {
    id: 'development',
    name: 'Development',
    fromCents: 200000,
    summary: 'One garment taken from design to a factory-ready technical package.',
    typicalTimeline: '2–4 weeks',
    includes: [
      'Finalised design for one garment',
      'Technical flats — front, back and construction details',
      'Tech pack: construction notes, measurement spec and bill of materials',
      '3D visualisation of the garment',
      'Two rounds of revisions',
    ],
  },
  {
    id: 'collection',
    name: 'Collection',
    fromCents: 500000,
    summary: 'A coordinated capsule, designed and documented as one body of work.',
    typicalTimeline: '4–8 weeks',
    includes: [
      'Range plan and collection direction',
      'Designs, technical flats and tech packs for each style',
      '3D visualisation across the range',
      'Product imagery and a campaign image set',
      'Revision rounds agreed per style',
    ],
  },
];

const SERVICES = [
  { id: 'design', name: 'Fashion design & collection development', text: 'Concept, silhouette, range planning and design development for single garments or full capsules.' },
  { id: 'technical', name: 'Technical flats, tech packs & specifications', text: 'Production-minded flats, construction callouts, points of measure and bills of materials your factory can work from.' },
  { id: '3d', name: '3D garment visualisation', text: 'Digital samples to judge proportion, fit intent and colourways before anything is cut.' },
  { id: 'imagery', name: 'Product imagery & campaigns', text: 'Product visuals and campaign imagery to launch, pre-sell or pitch the work.' },
];

const GARMENT_CATEGORIES = [
  'Outerwear', 'Tailoring', 'Shirting', 'Trousers & denim', 'Knitwear', 'Jersey & tees',
  'Dresses & skirts', 'Activewear', 'Swim & intimates', 'Accessories', 'Full collection', 'Other',
];

const DELIVERABLE_OPTIONS = [
  { id: 'design', label: 'Design sketches / concept' },
  { id: 'flats', label: 'Technical flats' },
  { id: 'techpack', label: 'Tech pack & specifications' },
  { id: '3d', label: '3D garment visualisation' },
  { id: 'imagery', label: 'Product imagery' },
  { id: 'campaign', label: 'Campaign assets' },
];

const BUDGET_OPTIONS = ['Under $750', '$750 – $2,000', '$2,000 – $5,000', '$5,000 – $10,000', '$10,000+', 'Not sure yet'];
const TIMELINE_OPTIONS = ['Within 2 weeks', '2–4 weeks', '1–2 months', '2+ months', 'Flexible'];

const DELIVERABLE_TYPES = ['design', 'flats', 'techpack', '3d', 'imagery', 'campaign', 'other'];

/**
 * Production job types: what a production task produces, which deliverable it becomes,
 * which integration could do it, and the minimum checklist QA holds the result to.
 */
const JOB_TYPES = {
  design: { label: 'Design development', deliverable: 'design', product: null, checklist: ['Front and back sketches', 'Colour and fabric callouts', 'Design options as agreed in the brief'] },
  technical_flats: { label: 'Technical flats', deliverable: 'flats', product: 'index_v3', checklist: ['Front view', 'Back view', 'Construction details and callouts', 'Stitch and trim annotations'] },
  tech_pack: { label: 'Tech pack', deliverable: 'techpack', product: 'index_v3', checklist: ['Points of measure table for the base size', 'Grading rules or size range', 'Bill of materials', 'Construction notes', 'Labelling and packaging notes'] },
  measurement_spec: { label: 'Measurement specification', deliverable: 'techpack', product: 'index_v3', checklist: ['Points of measure with definitions', 'Base size measurements', 'Tolerances'] },
  garment_3d: { label: '3D garment', deliverable: '3d', product: 'index_v3', checklist: ['Model built to the base-size measurements', 'Agreed colourways', 'Front, back and side renders'] },
  product_imagery: { label: 'Product imagery', deliverable: 'imagery', product: 'form', checklist: ['Front, back and detail shots', 'Long edge at least 2000 px', 'Consistent background and lighting'] },
  campaign_assets: { label: 'Campaign assets', deliverable: 'campaign', product: 'form', checklist: ['Formats and crops as agreed', 'Usage notes', 'Source files'] },
};
const REQUESTED_TO_JOB = { design: 'design', flats: 'technical_flats', techpack: 'tech_pack', '3d': 'garment_3d', imagery: 'product_imagery', campaign: 'campaign_assets' };

const DEFAULT_TERMS = [
  'Work begins once the deposit is received.',
  'The balance is due before final files are released.',
  'Scope covers design and development documentation only; manufacturing, sampling and physical production are not included.',
  'Additional revision rounds or scope changes are quoted separately before any extra work starts.',
].join('\n');

const packageById = (id) => PACKAGES.find((p) => p.id === id) || null;

module.exports = {
  PACKAGES, SERVICES, GARMENT_CATEGORIES, DELIVERABLE_OPTIONS, BUDGET_OPTIONS, TIMELINE_OPTIONS,
  DELIVERABLE_TYPES, DEFAULT_TERMS, packageById, JOB_TYPES, REQUESTED_TO_JOB,
};
