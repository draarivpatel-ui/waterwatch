const headers = 'tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt,pair_id,draw_type';

export const PRESETS = [
  {
    id: 'school',
    title: 'School tap',
    description: 'Synthetic first-draw spike at an older elementary school. The paired flushed tap shows why timing and plumbing matter.',
    csv: `${headers}
East hall fountain (first draw),none,absent,24.6,310,2.1,1.2,1.3,1.1,0.9,0.6,0.2,5,east-hall,first-draw
East hall fountain (flushed),none,absent,3.1,140,2.1,1.2,1.3,1.1,0.9,0.6,0.2,5,east-hall,flushed
Kitchen cold tap,none,absent,7.2,220,2.1,1.2,1.3,1.1,0.9,0.6,0.2,5,,`,
  },
  {
    id: 'well',
    title: 'Industrial corridor',
    description: 'Synthetic private-well measurements. No individual PFAS screen is above its benchmark, yet the combined mixture is.',
    csv: `${headers}
Well entry point,none,absent,1.7,68,2.9,3.2,3.999,3.7,5,4,3,140,,
Workshop cold tap,none,absent,2.2,92,2.9,3.2,3.9,3.7,4.9,3.9,2.8,140,,`,
  },
  {
    id: 'storm',
    title: 'After the storm',
    description: 'Synthetic post-storm boil notice with an E. coli detection and nitrate above the screening benchmark.',
    csv: `${headers}
North block kitchen,boil,present,2.4,125,13.6,2.1,1.4,0.9,0.4,0.2,0.5,15,,
South block kitchen,boil,unknown,3.2,150,11.2,2.2,1.8,1.1,0.4,0.3,0.5,20,,`,
  },
  {
    id: 'baseline',
    title: 'Municipal baseline',
    description: 'Synthetic hardened system with readings within the screened benchmarks. This does not certify potability.',
    csv: `${headers}
Treatment plant entry,none,absent,0.4,65,1.1,0.5,0.4,0.3,0.2,0.1,0.1,1.8,,
Library cold tap,none,absent,0.8,102,1.15,0.6,0.5,0.3,0.3,0.1,0.15,1.9,,`,
  },
];
