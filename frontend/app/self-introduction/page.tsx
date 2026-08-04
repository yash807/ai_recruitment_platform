"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  createMediaRecorder,
  getBackendMediaUrl,
  isFetchConnectionError,
  mediaRequestErrorMessage,
} from "../backend-media";

const API_URL = "/api";
const MIN_RECORDING_SECONDS = 60;
const MAX_RECORDING_SECONDS = 90;

const INTRODUCTION_PROMPTS = [
  "Your name, college, degree, and branch.",
  "The job role you are interested in.",
  "Your strongest technical skills.",
  "Your most important project and the problem it solves.",
  "Your personal contribution to that project.",
  "The technologies you used.",
  "A challenge you faced and how you solved it.",
  "Your internship or work experience, if any.",
  "Your career goal.",
];

type Student = {
  id: number;
  name: string;
  college: string | null;
  branch: string | null;
  target_role: string | null;
  self_introduction_status?: string | null;
};

type ChallengeResponse = {
  id?: number;
  introduction_id?: number;
  challenge?: string;
  challenge_text?: string;
  instruction?: string;
  detail?: string;
};

type SubmitResponse = {
  message?: string;
  status?: string;
  self_introduction_status?: string;
  identity_enrollment_status?: string;
  detail?: string;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function chooseRecordingMimeType() {
  const supportedTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return supportedTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export default function SelfIntroductionPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [introductionId, setIntroductionId] = useState<number | null>(null);
  const [challenge, setChallenge] = useState("");
  const [loading, setLoading] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedSecondsRef = useRef(0);

  useEffect(() => {
    const queryStudentId = Number(
      new URLSearchParams(window.location.search).get("student_id"),
    );
    const storedStudentId = Number(window.sessionStorage.getItem("studentId"));
    const resolvedStudentId = queryStudentId || storedStudentId;

    if (!resolvedStudentId) {
      router.replace("/student");
      return;
    }

    async function loadPage() {
      setLoading(true);
      setErrorMessage("");
      try {
        const [studentResponse, challengeResponse] = await Promise.all([
          fetch(`${API_URL}/students/${resolvedStudentId}`, {
            cache: "no-store",
          }),
          fetch(
            `${API_URL}/self-introductions/challenge/${resolvedStudentId}`,
            { cache: "no-store" },
          ),
        ]);
        setStudentId(resolvedStudentId);
        const studentResult = (await studentResponse.json()) as Student & {
          detail?: string;
        };
        const challengeResult =
          (await challengeResponse.json()) as ChallengeResponse;

        if (!studentResponse.ok) {
          throw new Error(
            studentResult.detail || "Could not load the student profile.",
          );
        }
        if (!challengeResponse.ok) {
          throw new Error(
            challengeResult.detail ||
              "Could not prepare the identity challenge.",
          );
        }

        const resolvedIntroductionId = Number(
          challengeResult.introduction_id ?? challengeResult.id,
        );
        const resolvedChallenge =
          challengeResult.challenge ||
          challengeResult.challenge_text ||
          challengeResult.instruction ||
          "";

        if (!resolvedIntroductionId || !resolvedChallenge) {
          throw new Error(
            "The backend returned an incomplete self-introduction challenge.",
          );
        }

        setStudent(studentResult);
        setIntroductionId(resolvedIntroductionId);
        setChallenge(resolvedChallenge);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not prepare the self-introduction.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadPage();

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [router]);

  useEffect(() => {
    if (!recording) return;

    const timer = window.setInterval(() => {
      const nextElapsed = elapsedSecondsRef.current + 1;
      elapsedSecondsRef.current = nextElapsed;
      setElapsedSeconds(nextElapsed);

      if (
        nextElapsed >= MAX_RECORDING_SECONDS &&
        recorderRef.current?.state === "recording"
      ) {
        recorderRef.current.stop();
        setRecording(false);
        setMessage("Maximum time reached. Review your recording, then continue.");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function enableCamera() {
    setErrorMessage("");
    setMessage("");

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error(
          "Camera and microphone recording is not supported in this browser.",
        );
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setCameraReady(true);
      setMessage(
        "Camera and microphone are ready. Keep your face visible and follow the identity instruction.",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Camera or microphone permission was not granted.",
      );
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || !cameraReady) {
      setErrorMessage("Enable your camera and microphone first.");
      return;
    }
    if (!challenge) {
      setErrorMessage("Wait for the identity instruction before recording.");
      return;
    }

    setErrorMessage("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setElapsedSeconds(0);
    elapsedSecondsRef.current = 0;
    chunksRef.current = [];

    const mimeType = chooseRecordingMimeType();
    const recorder = createMediaRecorder(stream, mimeType);
    const actualMimeType = recorder.mimeType || mimeType || "video/webm";

    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      setRecording(false);
      setErrorMessage("Recording failed. Please enable the camera and try again.");
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: actualMimeType });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      setPreviewUrl(URL.createObjectURL(blob));

      if (elapsedSecondsRef.current < MIN_RECORDING_SECONDS) {
        setErrorMessage(
          `Your introduction is ${elapsedSecondsRef.current} seconds. Please record at least 60 seconds.`,
        );
      } else {
        setMessage(
          "Recording complete. Uploading and checking your introduction automatically…",
        );
        void submitIntroduction(
          blob,
          actualMimeType,
          elapsedSecondsRef.current,
        );
      }
    };
    recorder.start(1000);
    setRecording(true);
    setMessage(
      "Recording started. Speak naturally, follow the template, and complete the identity instruction.",
    );
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "recording") return;
    recorderRef.current.stop();
    setRecording(false);
    setMessage("Recording stopped. Preparing your preview…");
  }

  async function retakeRecording() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setElapsedSeconds(0);
    elapsedSecondsRef.current = 0;
    setErrorMessage("");
    setMessage("Preparing a new verification phrase…");

    if (!studentId) {
      setErrorMessage("The student session is missing.");
      setMessage("");
      return;
    }
    try {
      const response = await fetch(
        `${API_URL}/self-introductions/challenge/${studentId}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as ChallengeResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || "Could not prepare a new verification phrase.",
        );
      }
      const nextIntroductionId = Number(result.introduction_id ?? result.id);
      const nextChallenge =
        result.challenge || result.challenge_text || result.instruction || "";
      if (!nextIntroductionId || !nextChallenge) {
        throw new Error(
          "The backend returned an incomplete self-introduction challenge.",
        );
      }
      setIntroductionId(nextIntroductionId);
      setChallenge(nextChallenge);
      setMessage("");
      await enableCamera();
    } catch (error) {
      setMessage("");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare a new verification phrase.",
      );
    }
  }

  async function submitIntroduction(
    recordedVideo: Blob,
    mimeType: string,
    durationSeconds: number,
  ) {
    if (!studentId || !introductionId) {
      setErrorMessage("The student or self-introduction session is missing.");
      return;
    }
    if (durationSeconds < MIN_RECORDING_SECONDS) {
      setErrorMessage("Please record a self-introduction of at least 60 seconds.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setMessage("Uploading introduction…");

    const checkingTimer = window.setTimeout(
      () => setMessage("Checking identity and liveness…"),
      1200,
    );
    const processingTimer = window.setTimeout(
      () => setMessage("Processing your self-introduction…"),
      3500,
    );

    try {
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const video = new File(
        [recordedVideo],
        `self-introduction-${studentId}.${extension}`,
        { type: mimeType || recordedVideo.type },
      );
      const formData = new FormData();
      formData.append("video", video);
      formData.append("duration_seconds", String(durationSeconds));

      const uploadUrl = await getBackendMediaUrl(
        `/self-introductions/${introductionId}/submit`,
      );
      const response = await fetch(
        uploadUrl,
        {
          method: "POST",
          body: formData,
        },
      );
      const responseText = await response.text();
      let result: SubmitResponse = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText) as SubmitResponse;
        } catch {
          throw new Error(
            response.ok
              ? "The backend returned an invalid self-introduction response."
              : responseText,
          );
        }
      }
      if (!response.ok) {
        throw new Error(
          result.detail ||
            "Identity verification failed. Improve the lighting and try again.",
        );
      }

      const status = (
        result.self_introduction_status ||
        result.status ||
        ""
      ).toLowerCase();
      const identityStatus = (
        result.identity_enrollment_status || ""
      ).toLowerCase();
      if (
        ["failed", "rejected"].includes(status) ||
        ["failed", "rejected", "not_verified"].includes(identityStatus)
      ) {
        throw new Error(
          result.message ||
            "We could not verify your identity. Improve the lighting and try again.",
        );
      }

      setMessage("Starting your mock interview…");
      window.setTimeout(() => {
        router.push(`/mock-interview?student_id=${studentId}`);
      }, 700);
    } catch (error) {
      if (isFetchConnectionError(error) && studentId) {
        try {
          const recoveryResponse = await fetch(
            `${API_URL}/students/${studentId}`,
            { cache: "no-store" },
          );
          if (recoveryResponse.ok) {
            const recoveredStudent: Student = await recoveryResponse.json();
            const recoveredStatus = (
              recoveredStudent.self_introduction_status || ""
            ).toLowerCase();
            if (recoveredStatus === "completed") {
              setMessage(
                "Self-introduction completed. The response disconnected, but your result was recovered from the server.",
              );
              window.setTimeout(() => {
                router.push(`/mock-interview?student_id=${studentId}`);
              }, 700);
              return;
            }
            if (recoveredStatus === "processing") {
              setErrorMessage(
                "The upload reached the server and is still processing. Wait a moment, then refresh this page to check the result.",
              );
              setMessage("");
              return;
            }
          }
        } catch {
          // Show the shared connection message when recovery is also unavailable.
        }
      }
      setErrorMessage(
        mediaRequestErrorMessage(
          error,
          "Could not submit the self-introduction.",
        ),
      );
      setMessage("");
      setSubmitting(false);
    } finally {
      window.clearTimeout(checkingTimer);
      window.clearTimeout(processingTimer);
    }
  }

  const recordingIsLongEnough = elapsedSeconds >= MIN_RECORDING_SECONDS;
  const backHref = studentId
    ? `/student/dashboard?student_id=${studentId}`
    : "/student";

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-12 h-96 w-96 rounded-full bg-cyan-100/80 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <Link
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-700"
            href={backHref}
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100">
              ←
            </span>
            Student dashboard
          </Link>
          <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
            Required before mock interview
          </span>
        </nav>

        <header className="fade-up mt-7 overflow-hidden rounded-3xl bg-slate-950 px-7 py-8 text-white shadow-2xl shadow-slate-300/60 sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">
            Step 2 · Self-introduction
          </p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-3xl font-black sm:text-5xl">
                Introduce your professional story
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Record one clear 60–90 second video. It will personalize your
                mock interview and create the identity reference used for later
                interview checks.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-3">
              <p className="text-xs text-slate-300">Current student</p>
              <p className="mt-1 font-extrabold">
                {student?.name || (loading ? "Loading…" : "Student")}
              </p>
            </div>
          </div>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
              Speaking template
            </p>
            <h2 className="mt-2 text-2xl font-black">What to explain</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Use this as a guide. Speak naturally instead of reading every line.
            </p>
            <ol className="mt-5 space-y-3">
              {INTRODUCTION_PROMPTS.map((prompt, index) => (
                <li
                  className="flex gap-3 rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700"
                  key={prompt}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-black text-indigo-700">
                    {index + 1}
                  </span>
                  {prompt}
                </li>
              ))}
            </ol>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase tracking-wider text-amber-800">
                Keep private information private
              </p>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Do not mention your home address, government ID, religion,
                caste, health information, or family details.
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl bg-[#080b18] p-6 text-white shadow-2xl shadow-slate-300/60 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                  Camera and identity check
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  Record your introduction
                </h2>
              </div>
              <div
                className={`rounded-xl px-4 py-2 text-center ${
                  recording
                    ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30"
                    : "bg-white/10 text-slate-200"
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider">
                  {recording ? "Recording" : "Duration"}
                </p>
                <p className="mt-0.5 font-mono text-xl font-black">
                  {formatTime(elapsedSeconds)} / 1:30
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                Identity instruction
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">
                {loading
                  ? "Preparing your random identity instruction…"
                  : challenge || "Identity instruction unavailable."}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                Keep exactly one face visible throughout the recording and
                perform this instruction during your introduction. Pause,
                speak the sentence slowly, and repeat it once before ending. This
                prototype stores a compact face reference to check continuity
                in later interviews; it does not determine legal identity or
                analyze emotion or demographic traits.
              </p>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black">
              {previewUrl ? (
                <video
                  className="aspect-video w-full object-cover"
                  controls
                  playsInline
                  src={previewUrl}
                />
              ) : (
                <div className="relative aspect-video">
                  <video
                    autoPlay
                    className="h-full w-full object-cover [transform:scaleX(-1)]"
                    muted
                    playsInline
                    ref={liveVideoRef}
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 grid place-items-center bg-slate-950 text-center">
                      <div className="max-w-xs px-5">
                        <p className="text-4xl">◉</p>
                        <p className="mt-3 font-bold">Camera preview</p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          Enable your camera and microphone when you are ready.
                        </p>
                      </div>
                    </div>
                  )}
                  {recording && (
                    <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                      REC
                    </span>
                  )}
                  {recording && challenge && (
                    <div className="absolute inset-x-4 bottom-4 rounded-xl border border-cyan-300/40 bg-slate-950/90 px-4 py-3 text-left shadow-xl backdrop-blur">
                      <p className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                        Say this slowly twice before stopping
                      </p>
                      <p className="mt-1 text-sm font-bold leading-5 text-white">
                        {challenge}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  recordingIsLongEnough ? "bg-emerald-400" : "bg-indigo-400"
                }`}
                style={{
                  width: `${Math.min(
                    (elapsedSeconds / MAX_RECORDING_SECONDS) * 100,
                    100,
                  )}%`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Minimum 1:00</span>
              <span>Maximum 1:30</span>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {!cameraReady && !previewUrl && (
                <button
                  className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-indigo-100 disabled:opacity-50"
                  disabled={loading || submitting || !challenge}
                  onClick={() => void enableCamera()}
                  type="button"
                >
                  Enable camera and microphone
                </button>
              )}
              {cameraReady && !recording && !previewUrl && (
                <button
                  className="rounded-xl bg-rose-500 px-5 py-3 text-sm font-black text-white hover:bg-rose-400"
                  onClick={startRecording}
                  type="button"
                >
                  Start recording
                </button>
              )}
              {recording && (
                <button
                  className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-100"
                  onClick={stopRecording}
                  type="button"
                >
                  Stop recording
                </button>
              )}
              {previewUrl && errorMessage && !submitting && (
                  <button
                    className="rounded-xl border border-white/20 px-5 py-3 text-sm font-black text-white hover:bg-white/10 disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => void retakeRecording()}
                    type="button"
                  >
                    Retake
                  </button>
              )}
            </div>

            {message && (
              <p
                aria-live="polite"
                className="mt-5 rounded-xl bg-white/5 px-4 py-3 text-sm text-slate-200"
              >
                {message}
              </p>
            )}
            {errorMessage && (
              <p
                aria-live="assertive"
                className="mt-5 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/20"
              >
                {errorMessage}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
