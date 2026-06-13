export interface RobloxPose {
  name: string;

  position: [number, number, number];

  rotation: [number, number, number, number, number, number, number, number, number];
  children: RobloxPose[];
  easingStyle: number;
  easingDirection: number;
}

export interface RobloxKeyframe {
  time: number;
  poses: RobloxPose[];
}

export interface RobloxAnimationClip {
  loop: boolean;
  priority: number;
  duration: number;
  keyframes: RobloxKeyframe[];
}

function parseCFrame(cfEl: Element): {
  position: [number, number, number];
  rotation: [number, number, number, number, number, number, number, number, number];
} {
  const getVal = (name: string) => parseFloat_(cfEl.querySelector(name)?.textContent || null);

  if (cfEl.querySelector('X')) {
    return {
      position: [getVal('X'), getVal('Y'), getVal('Z')],
      rotation: [
        getVal('R00'),
        getVal('R01'),
        getVal('R02'),
        getVal('R10'),
        getVal('R11'),
        getVal('R12'),
        getVal('R20'),
        getVal('R21'),
        getVal('R22'),
      ],
    };
  }

  const parts = (cfEl.textContent || '').trim().split(/\s+/).map(Number);
  if (parts.length >= 12) {
    return {
      position: [parts[0], parts[1], parts[2]],
      rotation: [
        parts[3],
        parts[4],
        parts[5],
        parts[6],
        parts[7],
        parts[8],
        parts[9],
        parts[10],
        parts[11],
      ],
    };
  }

  return {
    position: [0, 0, 0],
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
}

function parseFloat_(s: string | null): number {
  if (!s) return 0;
  const v = parseFloat(s.trim());
  return isNaN(v) ? 0 : v;
}

function parseInt_(s: string | null): number {
  if (!s) return 0;
  const v = parseInt(s.trim(), 10);
  return isNaN(v) ? 0 : v;
}

function parsePoses(itemElements: Element[]): RobloxPose[] {
  return itemElements
    .filter((el) => el.getAttribute('class') === 'Pose')
    .map((poseEl) => {
      const props = poseEl.querySelector(':scope > Properties');
      const nameProp = props?.querySelector('string[name="Name"]')?.textContent;
      const name = nameProp || poseEl.getAttribute('name') || 'Unknown';

      let position: [number, number, number] = [0, 0, 0];
      let rotation: [number, number, number, number, number, number, number, number, number] = [
        1, 0, 0, 0, 1, 0, 0, 0, 1,
      ];

      let easingStyle = 0;
      let easingDirection = 0;

      if (props) {
        const cfEl = props.querySelector('CoordinateFrame[name="CFrame"]');
        if (cfEl) {
          const parsed = parseCFrame(cfEl);
          position = parsed.position;
          rotation = parsed.rotation;
        }
        easingStyle = parseInt_(
          props.querySelector('token[name="EasingStyle"]')?.textContent || null,
        );
        easingDirection = parseInt_(
          props.querySelector('token[name="EasingDirection"]')?.textContent || null,
        );
      }

      const childItems = Array.from(poseEl.children).filter(
        (c) => c.tagName === 'Item',
      ) as Element[];

      return {
        name,
        position,
        rotation,
        easingStyle,
        easingDirection,
        children: parsePoses(childItems),
      };
    });
}

export function parseAnimationXml(xml: string): RobloxAnimationClip | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) return null;

    const kfsEl = doc.querySelector('Item[class="KeyframeSequence"]');
    if (!kfsEl) return null;

    const props = kfsEl.querySelector(':scope > Properties');
    let loop = false;
    let priority = 2;

    if (props) {
      const loopEl = props.querySelector('bool[name="Loop"]');
      loop = loopEl?.textContent?.trim() === 'true';
      const prioEl = props.querySelector('token[name="Priority"]');
      priority = parseInt_(prioEl?.textContent || null);
    }

    const keyframeEls = Array.from(kfsEl.children).filter(
      (c) => c.getAttribute('class') === 'Keyframe',
    ) as Element[];

    const keyframes: RobloxKeyframe[] = keyframeEls.map((kfEl) => {
      const kfProps = kfEl.querySelector(':scope > Properties');
      const time = parseFloat_(kfProps?.querySelector('float[name="Time"]')?.textContent || null);
      const poseItems = Array.from(kfEl.children).filter((c) => c.tagName === 'Item') as Element[];
      return {
        time,
        poses: parsePoses(poseItems),
      };
    });

    keyframes.sort((a, b) => a.time - b.time);
    const duration = keyframes.length > 0 ? keyframes[keyframes.length - 1].time : 0;

    return { loop, priority, duration, keyframes };
  } catch {
    return null;
  }
}
