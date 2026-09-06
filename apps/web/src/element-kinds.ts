/** Fixed browsing hints, not accessible names, replay selectors or solver verdicts. */
export const elementKindLabels = [
  'Other',
  'Button',
  'Link',
  'Form field',
  'Image',
  'Heading',
  'Table',
  'Region',
  'List',
  'Media',
] as const;
export type ElementKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const validElementKind = (value: unknown): value is ElementKind =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < elementKindLabels.length;

/** This fixed lookup is sent into the read-only browser collector; no raw metadata comes back. */
export const elementKindProjection = {
  tags: {
    button: 1,
    select: 3,
    textarea: 3,
    img: 4,
    svg: 4,
    h1: 5,
    h2: 5,
    h3: 5,
    h4: 5,
    h5: 5,
    h6: 5,
    table: 6,
    main: 7,
    nav: 7,
    aside: 7,
    header: 7,
    footer: 7,
    ul: 8,
    ol: 8,
    dl: 8,
    video: 9,
    audio: 9,
  },
  roles: {
    button: 1,
    link: 2,
    textbox: 3,
    searchbox: 3,
    combobox: 3,
    checkbox: 3,
    radio: 3,
    switch: 3,
    slider: 3,
    spinbutton: 3,
    img: 4,
    heading: 5,
    table: 6,
    grid: 6,
    treegrid: 6,
    region: 7,
    main: 7,
    navigation: 7,
    complementary: 7,
    banner: 7,
    contentinfo: 7,
    list: 8,
    listbox: 8,
    tree: 8,
  },
} satisfies { tags: Record<string, ElementKind>; roles: Record<string, ElementKind> };
