import { useEffect, useRef, useState } from 'react';

const FALLBACK_APP_VERSION = '1.3.13-hotfix.2';
const TOUR_VERSION_KEY = 'ism_seen_tour_version';

const STEPS = [
  {
    title: 'Welcome to ISpooferMotion!',
    text: "Let's take a quick tour to get you familiar with the app. You can skip this anytime.",
    target: null,
    placement: 'center',
    view: 'spoofer',
  },
  {
    title: 'Navigation',
    text: 'Use the sidebar to switch between the Spoofer, your Activity history, Profiles, and App Settings.',
    target: '.side-nav',
    placement: 'right',
    view: 'spoofer',
  },
  {
    title: 'Profiles',
    text: 'Manage multiple Roblox accounts and group configurations. Create a profile for each group you upload to!',
    target: ".side-link[title='Profiles']",
    placement: 'right',
    view: 'spoofer',
  },
  {
    title: 'Quick Setup',
    text: "This is where you configure your current run. Let's look at the required fields.",
    target: '.setup-card',
    placement: 'left',
    view: 'spoofer',
  },
  {
    title: 'Roblox Cookie',
    text: 'Your Cookie allows the app to perform uploads securely. Keep this private!',
    target: '#robloxCookie',
    placement: 'bottom',
    view: 'spoofer',
    link: {
      url: 'https://www.youtube.com/results?search_query=how+to+get+roblox+cookie',
      text: 'How to find it?',
    },
  },
  {
    title: 'Open Cloud API Key',
    text: "You need an API Key with 'Asset Upload' permissions for the Creator Store. Click 'Get Key' to open the dashboard.",
    target: '.api-key-row',
    placement: 'bottom',
    view: 'spoofer',
  },
  {
    title: 'Audio Quota',
    text: 'When in Sound Mode, your remaining Roblox audio upload quota is displayed next to the Output title automatically.',
    target: '#inline-quota',
    placement: 'top',
    view: 'spoofer',
  },
  {
    title: 'Run Modes',
    text: 'Toggle these switches to disable Auto Detect, enable Download Only mode, or turn on Sound Mode for audio spoofing.',
    target: '.switches-row',
    placement: 'left',
    view: 'spoofer',
  },
  {
    title: 'Advanced Settings',
    text: 'Need more control? You can configure concurrency limits, map overrides, and retry delays here.',
    target: '.advanced-setup-card',
    placement: 'left',
    view: 'spoofer',
  },
  {
    title: 'Asset IDs',
    text: 'Paste your Plugin output or Asset IDs here. The app automatically extracts any valid IDs from your text.',
    target: '.asset-textarea',
    placement: 'right',
    view: 'spoofer',
  },
  {
    title: 'Start Spoofer',
    text: 'Once everything is set, hit Start! The app will process, download, spoof, and upload your assets automatically.',
    target: '#run-spoofer-btn',
    placement: 'bottom',
    view: 'spoofer',
  },
  {
    title: 'Real-Time Output',
    text: "Watch the run logs here. You'll see exactly how many assets succeeded and how many failed.",
    target: '.output-card',
    placement: 'left',
    view: 'spoofer',
  },
  {
    title: 'Activity Feed',
    text: 'Check past batches and view detailed backend terminal logs in the Activity tab.',
    target: ".side-link[title='Activity']",
    placement: 'right',
    view: 'queue',
  },
  {
    title: 'Settings',
    text: 'Configure your default profile and global app behavior.',
    target: ".side-link[title='Settings']",
    placement: 'right',
    view: 'settings',
  },
  {
    title: 'Support the Project',
    text: 'If you find this tool helpful, consider donating to keep the project alive!',
    target: '#build-donate',
    placement: 'top',
    view: 'spoofer',
  },
  {
    title: "You're all set!",
    text: 'Happy spoofing! If you need help, join our Discord server from the top bar.',
    target: '.discord-button',
    placement: 'bottom',
    view: 'spoofer',
  },
];

export default function TourOverlay() {
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [holeStyle, setHoleStyle] = useState({});
  const [tooltipStyle, setTooltipStyle] = useState({});
  const appVersionRef = useRef('unknown');

  const tooltipRef = useRef(null);

  const startTour = () => {
    setCurrentStep(0);
    setActive(true);
    document.body.classList.add('tour-active');
  };

  const endTour = () => {
    setActive(false);
    document.body.classList.remove('tour-active');
    try {
      window.localStorage?.setItem(TOUR_VERSION_KEY, appVersionRef.current);
    } catch {
      // Local storage can be unavailable in hardened or private contexts.
    }
  };

  const renderStep = () => {
    const step = STEPS[currentStep];

    if (step.view) {
      const btn = document.querySelector(
        `.side-link[title='${step.view === 'spoofer' ? 'Spoofer' : step.view === 'queue' ? 'Activity' : step.view === 'settings' ? 'Settings' : 'Profiles'}']`,
      );
      if (btn) btn.click();
    }

    setTimeout(() => {
      if (step.target) {
        const targetEl = document.querySelector(step.target);
        if (targetEl && tooltipRef.current) {
          const rect = targetEl.getBoundingClientRect();
          setHoleStyle({
            top: `${rect.top - 8}px`,
            left: `${rect.left - 8}px`,
            width: `${rect.width + 16}px`,
            height: `${rect.height + 16}px`,
            opacity: 1,
          });

          const tooltipRect = tooltipRef.current.getBoundingClientRect();
          let top = 0;
          let left = 0;
          const p = step.placement;

          if (p === 'bottom') {
            top = rect.bottom + 24;
            left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          } else if (p === 'top') {
            top = rect.top - tooltipRect.height - 24;
            left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          } else if (p === 'right') {
            top = rect.top + rect.height / 2 - tooltipRect.height / 2;
            left = rect.right + 24;
          } else if (p === 'left') {
            top = rect.top + rect.height / 2 - tooltipRect.height / 2;
            left = rect.left - tooltipRect.width - 24;
          }

          if (left < 16) left = 16;
          if (left + tooltipRect.width > window.innerWidth - 16)
            left = window.innerWidth - tooltipRect.width - 16;
          if (top < 16) top = 16;
          if (top + tooltipRect.height > window.innerHeight - 16)
            top = window.innerHeight - tooltipRect.height - 16;

          setTooltipStyle({ top: `${top}px`, left: `${left}px`, transform: 'none' });
        } else {
          setHoleStyle({ width: '0px', height: '0px', top: '50%', left: '50%', opacity: 0 });
          setTooltipStyle({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
        }
      } else {
        setHoleStyle({ width: '0px', height: '0px', top: '50%', left: '50%', opacity: 0 });
        setTooltipStyle({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      }
    }, 200);
  };

  useEffect(() => {
    let cancelled = false;

    const maybeStartTour = async () => {
      let version = FALLBACK_APP_VERSION;
      try {
        version = (await window.electronAPI?.getAppVersion?.()) || FALLBACK_APP_VERSION;
      } catch (error) {
        console.warn('Failed to read app version for tour', error);
      }
      if (cancelled) return;
      appVersionRef.current = String(version);
      let seenVersion = null;
      try {
        seenVersion = window.localStorage?.getItem(TOUR_VERSION_KEY) || null;
      } catch (error) {
        console.warn('Failed to read tour version from local storage', error);
      }
      if (seenVersion !== appVersionRef.current) {
        setTimeout(() => {
          if (!cancelled) startTour();
        }, 1000);
      }
    };

    maybeStartTour();

    const startTourHandler = () => startTour();
    window.addEventListener('start-tour', startTourHandler);
    return () => {
      cancelled = true;
      window.removeEventListener('start-tour', startTourHandler);
    };
  }, []);

  useEffect(() => {
    if (active) {
      renderStep();
    }
  }, [currentStep, active]);

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep((c) => c + 1);
    else endTour();
  };

  const prevStep = () => {
    if (currentStep > 0) setCurrentStep((c) => c - 1);
  };

  if (!active) return null;

  const step = STEPS[currentStep];

  return (
    <>
      <div className={`tour-backdrop ${active ? 'active' : ''}`} id="tour-backdrop"></div>
      <div
        className={`tour-overlay-hole ${active && step?.target ? 'has-target active' : 'active'}`}
        id="tour-overlay-hole"
        style={holeStyle}
      ></div>
      <div
        className={`tour-tooltip ${active ? 'active' : ''}`}
        id="tour-tooltip"
        ref={tooltipRef}
        style={tooltipStyle}
      >
        <div className="tour-tooltip-header">
          <h4 className="tour-tooltip-title" id="tour-title">
            {step?.title}
          </h4>
        </div>
        <p className="tour-tooltip-text" id="tour-text">
          {step?.text}
        </p>

        {step?.link && (
          <a
            className="tour-link"
            id="tour-link"
            style={{ display: 'inline-block' }}
            onClick={() => window.electronAPI?.openExternal?.(step.link.url)}
          >
            {step.link.text}
          </a>
        )}

        <div className="tour-controls">
          <span className="tour-dots" id="tour-dots">
            {currentStep + 1} / {STEPS.length}
          </span>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              className="ui-button"
              id="tour-skip-btn"
              type="button"
              style={{ minHeight: 0, height: '28px', padding: '0 12px' }}
              onClick={endTour}
            >
              Skip
            </button>
            <button
              className="ui-button"
              id="tour-prev-btn"
              type="button"
              style={{ minHeight: 0, height: '28px', padding: '0 12px' }}
              disabled={currentStep === 0}
              onClick={prevStep}
            >
              Back
            </button>
            <button
              className="primary-action"
              id="tour-next-btn"
              type="button"
              style={{ minHeight: 0, height: '28px', padding: '0 12px' }}
              onClick={nextStep}
            >
              {currentStep === STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
