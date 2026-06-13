export interface RigBone {
  name: string;
  parent: string | null;
  c0: number[];
  c1: number[];
  size: [number, number, number];
}

export type RigType = 'R6' | 'R15';

const IDR = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const R6_BONES: RigBone[] = [
  {
    name: 'HumanoidRootPart',
    parent: null,
    c0: [0, 0, 0, ...IDR],
    c1: [0, 0, 0, ...IDR],
    size: [2, 2, 1],
  },
  {
    name: 'Torso',
    parent: 'HumanoidRootPart',
    c0: [0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0],
    c1: [0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0],
    size: [2, 2, 1],
  },
  {
    name: 'Head',
    parent: 'Torso',
    c0: [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0],
    c1: [0, -0.5, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0],
    size: [1.2, 1.2, 1.2],
  },
  {
    name: 'Right Arm',
    parent: 'Torso',
    c0: [1, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0],
    c1: [-0.5, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0],
    size: [1, 2, 1],
  },
  {
    name: 'Left Arm',
    parent: 'Torso',
    c0: [-1, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0],
    c1: [0.5, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0],
    size: [1, 2, 1],
  },
  {
    name: 'Right Leg',
    parent: 'Torso',
    c0: [1, -1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0],
    c1: [0.5, 1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0],
    size: [1, 2, 1],
  },
  {
    name: 'Left Leg',
    parent: 'Torso',
    c0: [-1, -1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0],
    c1: [-0.5, 1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0],
    size: [1, 2, 1],
  },
];

export const R15_BONES: RigBone[] = [
  {
    name: 'HumanoidRootPart',
    parent: null,
    c0: [0, 0, 0, ...IDR],
    c1: [0, 0, 0, ...IDR],
    size: [2, 2, 1],
  },
  {
    name: 'LowerTorso',
    parent: 'HumanoidRootPart',
    c0: [0, -1, 0, ...IDR],
    c1: [0, -0.2, 0, ...IDR],
    size: [2, 0.4, 1],
  },

  {
    name: 'UpperTorso',
    parent: 'LowerTorso',
    c0: [0, 0.2, 0, ...IDR],
    c1: [0, -0.8, 0, ...IDR],
    size: [2, 1.6, 1],
  },

  {
    name: 'Head',
    parent: 'UpperTorso',
    c0: [0, 0.8, 0, ...IDR],
    c1: [0, -0.586, 0, ...IDR],
    size: [1.2, 1.2, 1.2],
  },

  {
    name: 'LeftUpperArm',
    parent: 'UpperTorso',
    c0: [-1, 0.563, 0, ...IDR],
    c1: [0.5, 0.394, 0, ...IDR],
    size: [1, 1.169, 1],
  },

  {
    name: 'LeftLowerArm',
    parent: 'LeftUpperArm',
    c0: [0, -0.334, 0, ...IDR],
    c1: [0, 0.259, 0, ...IDR],
    size: [1, 1.052, 1],
  },

  {
    name: 'LeftHand',
    parent: 'LeftLowerArm',
    c0: [0, -0.501, 0, ...IDR],
    c1: [0, 0.125, 0, ...IDR],
    size: [1, 0.3, 1],
  },

  {
    name: 'RightUpperArm',
    parent: 'UpperTorso',
    c0: [1, 0.563, 0, ...IDR],
    c1: [-0.5, 0.394, 0, ...IDR],
    size: [1, 1.169, 1],
  },
  {
    name: 'RightLowerArm',
    parent: 'RightUpperArm',
    c0: [0, -0.334, 0, ...IDR],
    c1: [0, 0.259, 0, ...IDR],
    size: [1, 1.052, 1],
  },
  {
    name: 'RightHand',
    parent: 'RightLowerArm',
    c0: [0, -0.501, 0, ...IDR],
    c1: [0, 0.125, 0, ...IDR],
    size: [1, 0.3, 1],
  },

  {
    name: 'LeftUpperLeg',
    parent: 'LowerTorso',
    c0: [-0.5, -0.2, 0, ...IDR],
    c1: [0, 0.421, 0, ...IDR],
    size: [1, 1.217, 1],
  },

  {
    name: 'LeftLowerLeg',
    parent: 'LeftUpperLeg',
    c0: [0, -0.401, 0, ...IDR],
    c1: [0, 0.379, 0, ...IDR],
    size: [1, 1.193, 1],
  },

  {
    name: 'LeftFoot',
    parent: 'LeftLowerLeg',
    c0: [0, -0.547, 0, ...IDR],
    c1: [0, 0.102, 0, ...IDR],
    size: [1, 0.3, 1],
  },

  {
    name: 'RightUpperLeg',
    parent: 'LowerTorso',
    c0: [0.5, -0.2, 0, ...IDR],
    c1: [0, 0.421, 0, ...IDR],
    size: [1, 1.217, 1],
  },
  {
    name: 'RightLowerLeg',
    parent: 'RightUpperLeg',
    c0: [0, -0.401, 0, ...IDR],
    c1: [0, 0.379, 0, ...IDR],
    size: [1, 1.193, 1],
  },
  {
    name: 'RightFoot',
    parent: 'RightLowerLeg',
    c0: [0, -0.547, 0, ...IDR],
    c1: [0, 0.102, 0, ...IDR],
    size: [1, 0.3, 1],
  },
];

export function getBones(rigType: RigType): RigBone[] {
  return rigType === 'R6' ? R6_BONES : R15_BONES;
}

export function detectRigType(poseNames: Set<string>): RigType {
  const r15Bones = new Set([
    'LowerTorso',
    'UpperTorso',
    'LeftUpperArm',
    'RightUpperArm',
    'LeftUpperLeg',
    'RightUpperLeg',
  ]);
  for (const name of r15Bones) {
    if (poseNames.has(name)) return 'R15';
  }
  return 'R6';
}
