"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// All browser requests stay on the Next.js origin and are proxied to FastAPI.
const API_URL = "/api";

// Student-safe session returned by the company-interview API.
type CompanyInterviewSession = {
  id: number;
  application_id: number;
  company_name: string;
  job_title: string;
  questions: string[];
  recorded_question_indexes: number[];
  status: string;
  analysis_status: string;
};

type VideoAnswerResult = {
  message: string;
  interview_id: number;
  question_index: number;
  recorded_question_indexes: number[];
  status: string;
  detail?: string;
};

type SubmissionResult = {
  interview_id: number;
  status: string;
  analysis_status: string;
  message: string;
  detail?: string;
};

export default function CompanyInterviewPage() {
  // Interview progress visible to the student.
  const [interview, setInterview] =
    useState<CompanyInterviewSession | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(
    "Loading your eligible application...",
  );
  const [previewUrl, setPreviewUrl] = useState("");

  // Media objects stay in refs because they should not trigger rerenders.
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Start or resume the interview identified by application_id in the URL.
  useEffect(() => {
    async function loadCompanyInterview() {
      const applicationId = new URLSearchParams(window.location.search).get(
        "application_id",
      );
      if (!applicationId) {
        setMessage(
          "No application was provided. Open this interview from an eligible job application.",
        );
        return;
      }

      try {
        const response = await fetch(
          `${API_URL}/company-interviews/start/${applicationId}`,
          { method: "POST" },
        );
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            result.detail || "Could not start the company interview.",
          );
        }

        setInterview(result);
        const firstUnrecorded = result.questions.findIndex(
          (_question: string, index: number) =>
            !result.recorded_question_indexes.includes(index),
        );
        setCurrentQuestionIndex(firstUnrecorded === -1 ? 0 : firstUnrecorded);
        setMessage(
          result.analysis_status === "Completed"
            ? "This interview has already been submitted for recruiter review."
            : result.recorded_question_indexes.length
              ? "Your saved interview was restored. Continue from the next question."
              : "Interview ready. Enable your camera and microphone when prepared.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load the company interview.",
        );
      }
    }

    void loadCompanyInterview();

    // Stop camera and microphone when the student leaves this page.
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Release old local video previews from browser memory.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Ask the browser for camera and microphone permission.
  async function enableCamera() {
    setMessage("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera and microphone recording is not supported in this browser.",
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setCameraReady(true);
      setMessage("Camera and microphone are ready.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Camera or microphone permission was not granted.",
      );
    }
  }

  // Convert the browser recording into a file and send it to FastAPI.
  async function uploadRecordedAnswer(blob: Blob, mimeType: string) {
    if (!interview) return;

    setUploading(true);
    try {
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const videoFile = new File(
        [blob],
        `question-${currentQuestionIndex + 1}.${extension}`,
        { type: mimeType },
      );
      const uploadData = new FormData();
      uploadData.append("video", videoFile);

      const response = await fetch(
        `${API_URL}/company-interviews/${interview.id}/answers/${currentQuestionIndex}`,
        {
          method: "POST",
          body: uploadData,
        },
      );
      const result: VideoAnswerResult = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not save the video answer.");
      }

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setInterview((current) =>
        current
          ? {
              ...current,
              recorded_question_indexes: result.recorded_question_indexes,
              status: result.status,
            }
          : current,
      );

      if (result.status === "Ready to Submit") {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setCameraReady(false);
        setMessage(
          "All five answers are saved. Submit them for private recruiter analysis.",
        );
      } else {
        setCurrentQuestionIndex((current) => current + 1);
        setMessage("Answer saved. Continue with the next question.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the answer.",
      );
    } finally {
      setUploading(false);
    }
  }

  // Start MediaRecorder and collect video/audio data in small chunks.
  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setMessage("Enable the camera and microphone first.");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported(
      "video/webm;codecs=vp9,opus",
    )
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      void uploadRecordedAnswer(blob, mimeType);
    };
    recorder.start();
    setRecording(true);
    setMessage("Recording your answer...");
  }

  // Stopping MediaRecorder automatically triggers the upload handler.
  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecording(false);
      setMessage("Recording stopped. Saving your answer...");
    }
  }

  // Run local transcription/evaluation and save the private recruiter result.
  async function submitInterview() {
    if (!interview) return;

    setSubmitting(true);
    setMessage(
      "Submitting interview. Local transcription and evaluation may take a few minutes...",
    );
    try {
      const response = await fetch(
        `${API_URL}/company-interviews/${interview.id}/submit`,
        { method: "POST" },
      );
      const responseText = await response.text();
      let result: SubmissionResult & { detail?: string };
      try {
        result = JSON.parse(responseText) as SubmissionResult & {
          detail?: string;
        };
      } catch {
        throw new Error(
          response.ok
            ? "The backend returned an invalid interview response."
            : responseText || "The backend could not submit the interview.",
        );
      }
      if (!response.ok) {
        throw new Error(result.detail || "Could not submit the interview.");
      }

      setInterview((current) =>
        current
          ? {
              ...current,
              status: result.status,
              analysis_status: result.analysis_status,
            }
          : current,
      );
      setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not submit the interview.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const readyToSubmit = interview?.status === "Ready to Submit";
  const submitted = interview?.analysis_status === "Completed";
  const currentQuestion = interview?.questions[currentQuestionIndex];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07110f] px-5 py-7 text-white sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-10 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        {/* Student navigation and privacy indicator. */}
        <nav className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white"
            href="/"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">
              ←
            </span>
            Student workspace
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Company interview
          </span>
        </nav>

        {/* Company-specific interview introduction. */}
        <header className="fade-up mt-9">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
            Recruitment interview
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">
            Company-specific AI video interview
          </h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Questions are generated from the company job description, required
            skills, selected role, and your resume context.
          </p>
        </header>

        {/* Application and interview identity. */}
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.055] p-6 shadow-2xl backdrop-blur-xl">
          {interview ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
                  {interview.company_name}
                </p>
                <h2 className="mt-2 text-xl font-bold">
                  {interview.job_title}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Application {interview.application_id} · Interview{" "}
                  {interview.id}
                </p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">
                {interview.status}
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-300">
              Checking the selected application...
            </p>
          )}

          {message && (
            <p className="mt-4 rounded-lg bg-white/5 px-3 py-2 text-sm leading-6 text-slate-200">
              {message}
            </p>
          )}
        </section>

        {/* Question progress and browser video recorder. */}
        {interview && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <span>Interview progress</span>
                <span>
                  {interview.recorded_question_indexes.length}/
                  {interview.questions.length} saved
                </span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
                  style={{
                    width: `${
                      (interview.recorded_question_indexes.length /
                        interview.questions.length) *
                      100
                    }%`,
                  }}
                />
              </div>

              {submitted ? (
                <div className="mt-8 rounded-xl bg-emerald-500/10 p-6 text-center ring-1 ring-emerald-400/30">
                  <p className="text-4xl">✓</p>
                  <h2 className="mt-3 text-xl font-bold text-emerald-300">
                    Interview submitted
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Your recordings and private evaluation are ready for
                    recruiter review. Scores are not displayed to candidates.
                  </p>
                </div>
              ) : readyToSubmit ? (
                <div className="mt-8 rounded-xl bg-cyan-500/10 p-6 text-center ring-1 ring-cyan-400/30">
                  <p className="text-4xl">✓</p>
                  <h2 className="mt-3 text-xl font-bold text-cyan-200">
                    All answers recorded
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Submit once. The recordings will be transcribed locally and
                    evaluated against the company role.
                  </p>
                  <button
                    className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-950/50 hover:-translate-y-0.5 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
                    disabled={submitting}
                    onClick={() => void submitInterview()}
                    type="button"
                  >
                    {submitting
                      ? "Transcribing and submitting..."
                      : "Submit company interview"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-8 text-sm font-semibold text-emerald-300">
                    Question {currentQuestionIndex + 1} of{" "}
                    {interview.questions.length}
                  </p>
                  <h2 className="mt-3 text-2xl font-bold leading-9">
                    {currentQuestion}
                  </h2>
                  <p className="mt-5 text-sm leading-6 text-slate-400">
                    Give a clear 30–60 second answer. Mention your contribution,
                    technical decisions, and result wherever relevant.
                  </p>
                </>
              )}
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-inner ring-1 ring-white/10">
                <video
                  autoPlay
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  ref={liveVideoRef}
                />
                <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold backdrop-blur">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      recording
                        ? "animate-pulse bg-red-500"
                        : cameraReady
                          ? "bg-emerald-400"
                          : "bg-slate-500"
                    }`}
                  />
                  {recording
                    ? "REC"
                    : cameraReady
                      ? "Camera ready"
                      : "Camera off"}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {!cameraReady && !readyToSubmit && !submitted && (
                  <button
                    className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 shadow-lg hover:-translate-y-0.5 hover:bg-emerald-50"
                    onClick={() => void enableCamera()}
                    type="button"
                  >
                    Enable camera and microphone
                  </button>
                )}
                {cameraReady && !recording && !readyToSubmit && !submitted && (
                  <button
                    className="rounded-xl bg-red-500 px-5 py-3 font-bold shadow-lg shadow-red-950/50 hover:-translate-y-0.5 hover:bg-red-400 disabled:opacity-50"
                    disabled={uploading}
                    onClick={startRecording}
                    type="button"
                  >
                    Start recording
                  </button>
                )}
                {recording && (
                  <button
                    className="rounded-xl bg-white px-5 py-3 font-bold text-red-600 shadow-lg hover:bg-red-50"
                    onClick={stopRecording}
                    type="button"
                  >
                    Stop and save answer
                  </button>
                )}
              </div>

              {previewUrl && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Last saved answer preview
                  </p>
                  <video
                    className="aspect-video w-full rounded-xl bg-black object-cover"
                    controls
                    src={previewUrl}
                  />
                </div>
              )}

              <p className="mt-5 text-xs leading-5 text-slate-400">
                Video files remain in the prototype&apos;s local uploads folder.
                Transcription uses the local Whisper model; no paid API is
                required.
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
