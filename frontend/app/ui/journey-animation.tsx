"use client";

import { CSSProperties, useEffect, useState } from "react";

const steps = [
  {
    title: "Build your foundation",
    shortTitle: "Profile ready",
    description: "Create one complete profile and bring your education, skills, projects and resume together.",
    signal: "Profile completeness",
    value: "94%",
  },
  {
    title: "Understand your readiness",
    shortTitle: "Readiness mapped",
    description: "AI analyzes ATS strength, role alignment and the evidence behind your experience.",
    signal: "Evidence signals",
    value: "12",
  },
  {
    title: "Match and interview",
    shortTitle: "Interview complete",
    description: "Practise or interview for a real role with structured, role-aware questions and feedback.",
    signal: "Role match",
    value: "86%",
  },
  {
    title: "Share a clear outcome",
    shortTitle: "Decision published",
    description: "Recruitment and institutes see consistent results while professionals receive the published outcome.",
    signal: "Decision confidence",
    value: "High",
  },
] as const;

function JourneyIcon({ index }: { index: number }) {
  const paths = [
    <path d="M8 18v-1.5A3.5 3.5 0 0 1 11.5 13h3a3.5 3.5 0 0 1 3.5 3.5V18M13 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-3v5m-2.5-2.5h5" key="profile" />,
    <path d="M12 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5Zm7 12v5m-2.5-2.5h5" key="ai" />,
    <path d="M5 17.5V15a7 7 0 0 1 14 0v2.5M8 18h8M12 4V2.5M4.5 8 3 7m16.5 1L21 7M9.5 14l2 2 3.5-4" key="interview" />,
    <path d="M5 4h14v16H5zM8 8h8m-8 4h5m-5 4h3m4-1 1.5 1.5L20 13" key="outcome" />,
  ];

  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">{paths[index]}</svg>;
}

export function JourneyAnimation() {
  const [activeStep, setActiveStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!autoPlay || reduceMotion) return;

    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, 2700);

    return () => window.clearInterval(timer);
  }, [autoPlay]);

  const current = steps[activeStep];
  const cursorStyle = { "--journey-step": activeStep } as CSSProperties;

  return (
    <div className="journey-experience" onMouseLeave={() => setAutoPlay(true)}>
      <div className="journey-preview" aria-live="polite">
        <div className="journey-preview-top">
          <span className="journey-live-dot" />
          <span>AI Talent journey</span>
          <span className="ml-auto">0{activeStep + 1} / 04</span>
        </div>
        <div className="journey-icon"><JourneyIcon index={activeStep} /></div>
        <p>Step {activeStep + 1} of 4</p>
        <h3>{current.shortTitle}</h3>
        <div className="journey-signal">
          <span>{current.signal}</span>
          <strong>{current.value}</strong>
        </div>
        <div className="journey-dots" aria-hidden="true">
          {steps.map((step, index) => <span className={index === activeStep ? "is-active" : ""} key={step.title} />)}
        </div>
      </div>

      <div className="journey-step-list">
        <span className="journey-track" aria-hidden="true"><span style={{ height: `${(activeStep / (steps.length - 1)) * 100}%` }} /></span>
        {steps.map((step, index) => (
          <button
            aria-pressed={index === activeStep}
            className={`journey-step-button ${index === activeStep ? "is-active" : ""}`}
            key={step.title}
            onClick={() => {
              setActiveStep(index);
              setAutoPlay(false);
            }}
            onMouseEnter={() => setAutoPlay(false)}
            type="button"
          >
            <span className="journey-step-number">{index + 1}</span>
            <span><strong>{step.title}</strong><small>{step.description}</small></span>
          </button>
        ))}

        <span className="journey-cursor" style={cursorStyle} aria-hidden="true">
          <svg viewBox="0 0 30 36"><path d="M3 2.5v27l7.2-7 5.1 10.3 5.2-2.6-5-9.8h10L3 2.5Z" /></svg>
          <span className="journey-click-pulse" key={activeStep} />
          <b>Explore</b>
        </span>
      </div>
    </div>
  );
}
