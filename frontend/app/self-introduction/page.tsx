"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import {
  createMediaRecorder,
  getBackendMediaUrl,
  isFetchConnectionError,
  mediaRequestErrorMessage,
} from "../backend-media";

const API_URL = "/api";
const MAX_RECORDING_SECONDS = 75;
const MIN_VIDEO_SECONDS = 10;
const QUESTION_TIME_LIMIT_SECONDS = 5;

const INTRODUCTION_PROMPTS = [
  "Your name, college, degree, branch, and current year.",
  "The job role you are targeting and why it interests you.",
  "Your strongest technical skills.",
  "Your most important project and the problem it solves.",
  "Your personal contribution to that project.",
  "The main technologies you used.",
  "A challenge you faced and how you solved it.",
  "Your internship or work experience, if any.",
  "Your career goal.",
  "The verification phrase shown on this page.",
];

type Student = {
  id: number;
  name: string;
  self_introduction_status?: string | null;
};

type ChallengeResponse = {
  id?: number;
  introduction_id?: number;
  challenge?: string;
  challenge_phrase?: string;
  detail?: string;
};

type QuestionAnswer = {
  question_number: number;
  prompt: string;
  transcript: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  time_limit_seconds: number;
  within_time_limit: boolean;
};

type SubmitResponse = {
  message?: string;
  status?: string;
  self_introduction_status?: string;
  identity_enrollment_status?: string;
  question_answers?: QuestionAnswer[];
  timing_summary?: {
    question_count: number;
    within_time_limit_count: number;
    time_limit_seconds: number;
    total_answer_seconds: number;
  };
  detail?: string;
};

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function chooseRecordingMimeType() {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}

function readVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (Number.isFinite(duration)) {
        resolve(duration);
      } else {
        reject(new Error("Invalid video duration."));
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected video could not be read."));
    };
    video.src = url;
  });
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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const queryId = Number(new URLSearchParams(window.location.search).get("student_id"));
    const storedId = Number(window.sessionStorage.getItem("studentId"));
    const resolvedId = queryId || storedId;
    if (!resolvedId) {
      router.replace("/student");
      return;
    }

    async function loadPage() {
      try {
        const [studentResponse, challengeResponse] = await Promise.all([
          fetch(`${API_URL}/students/${resolvedId}`, { cache: "no-store" }),
          fetch(`${API_URL}/self-introductions/challenge/${resolvedId}`, { cache: "no-store" }),
        ]);
        const studentResult = (await studentResponse.json()) as Student & { detail?: string };
        const challengeResult = (await challengeResponse.json()) as ChallengeResponse;
        if (!studentResponse.ok) throw new Error(studentResult.detail || "Could not load the student.");
        if (!challengeResponse.ok) throw new Error(challengeResult.detail || "Could not prepare the introduction.");
        const nextIntroductionId = Number(challengeResult.introduction_id ?? challengeResult.id);
        const nextChallenge = challengeResult.challenge || challengeResult.challenge_phrase || "";
        if (!nextIntroductionId || !nextChallenge) throw new Error("The introduction challenge was incomplete.");
        setStudentId(resolvedId);
        setStudent(studentResult);
        setIntroductionId(nextIntroductionId);
        setChallenge(nextChallenge);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not prepare the self-introduction.");
      } finally {
        setLoading(false);
      }
    }
    void loadPage();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [router]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORDING_SECONDS && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setRecording(false);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function setSelectedVideo(file: File, duration: number) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setVideoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setDurationSeconds(duration);
    setElapsedSeconds(Math.round(duration));
    setResult(null);
    setErrorMessage("");
    setMessage("Video ready. Review it, then submit it for timing and identity checks.");
  }

  async function selectUploadedVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const duration = await readVideoDuration(file);
      if (duration < MIN_VIDEO_SECONDS || duration > MAX_RECORDING_SECONDS + 2) {
        throw new Error("Choose one continuous video between 10 and 75 seconds.");
      }
      setSelectedVideo(file, duration);
    } catch (error) {
      event.target.value = "";
      setErrorMessage(error instanceof Error ? error.message : "The video could not be selected.");
    }
  }

  async function enableCamera() {
    setErrorMessage("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("Camera recording is not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setCameraReady(true);
      setMessage("Camera ready. Say “Question 1” before the first answer and continue in order.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Camera permission was not granted.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || !cameraReady) return setErrorMessage("Enable the camera first.");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setVideoFile(null);
    setResult(null);
    setErrorMessage("");
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    chunksRef.current = [];
    const requestedType = chooseRecordingMimeType();
    const recorder = createMediaRecorder(stream, requestedType);
    const actualType = recorder.mimeType || requestedType || "video/webm";
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
    recorder.onerror = () => setErrorMessage("Recording failed. Please try again.");
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: actualType });
      const extension = actualType.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `self-introduction.${extension}`, { type: actualType });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      if (elapsedRef.current < MIN_VIDEO_SECONDS) {
        setErrorMessage("Record at least 10 seconds and include all ten numbered answers.");
        return;
      }
      setSelectedVideo(file, elapsedRef.current);
    };
    recorder.start(1000);
    setRecording(true);
    setMessage("Recording. Keep one face visible and say every question number clearly.");
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }

  async function prepareRetake() {
    if (!studentId) return;
    setResult(null);
    setVideoFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setDurationSeconds(0);
    setElapsedSeconds(0);
    setErrorMessage("");
    setMessage("Preparing a fresh verification phrase…");
    try {
      const response = await fetch(`${API_URL}/self-introductions/challenge/${studentId}`, { cache: "no-store" });
      const data = (await response.json()) as ChallengeResponse;
      if (!response.ok) throw new Error(data.detail || "Could not prepare a retake.");
      setIntroductionId(Number(data.introduction_id ?? data.id));
      setChallenge(data.challenge || data.challenge_phrase || "");
      setMessage("");
    } catch (error) {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Could not prepare a retake.");
    }
  }

  async function submitIntroduction() {
    if (!videoFile || !studentId || !introductionId) return setErrorMessage("Select or record a video first.");
    setSubmitting(true);
    setErrorMessage("");
    setMessage("Uploading, transcribing, and measuring all ten answers…");
    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("duration_seconds", String(durationSeconds));
      const uploadUrl = await getBackendMediaUrl(`/self-introductions/${introductionId}/submit`);
      const response = await fetch(uploadUrl, { method: "POST", body: formData });
      const responseText = await response.text();
      let data: SubmitResponse = {};
      if (responseText) data = JSON.parse(responseText) as SubmitResponse;
      if (!response.ok) throw new Error(data.detail || "The self-introduction could not be processed.");
      setResult(data);
      setMessage("Self-introduction completed. Review the measured time for every answer below.");
    } catch (error) {
      if (isFetchConnectionError(error)) {
        setErrorMessage("The upload connection closed while processing. Refresh once to check whether it completed.");
      } else {
        setErrorMessage(mediaRequestErrorMessage(error, "Could not submit the self-introduction."));
      }
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  const backHref = studentId ? `/student/dashboard?student_id=${studentId}` : "/student";

  return (
    <main className="surface-grid relative min-h-screen bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <Link className="text-sm font-bold text-slate-600 hover:text-indigo-700" href={backHref}>← Student dashboard</Link>
          <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">Required before mock interview</span>
        </nav>

        <header className="mt-7 rounded-3xl bg-slate-950 px-7 py-8 text-white shadow-2xl sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">Step 2 · Numbered self-introduction</p>
          <h1 className="mt-3 text-3xl font-black sm:text-5xl">Post one video. We time every answer.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            Start each response by clearly saying “Question 1”, “Question 2”, and so on. Keep each answer near {QUESTION_TIME_LIMIT_SECONDS} seconds; the complete video should stay under 1:15.
          </p>
          <p className="mt-4 text-sm font-bold text-white">Student: {student?.name || (loading ? "Loading…" : "Student")}</p>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Ten numbered answers</p>
            <h2 className="mt-2 text-2xl font-black">Say the marker, then answer</h2>
            <ol className="mt-5 space-y-3">
              {INTRODUCTION_PROMPTS.map((prompt, index) => (
                <li className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700" key={prompt}>
                  <span className="font-black text-indigo-700">Question {index + 1}. </span>{index === 9 ? challenge || prompt : prompt}
                </li>
              ))}
            </ol>
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              Do not mention your address, government ID, religion, caste, health information, or family details.
            </div>
          </section>

          <section className="rounded-3xl bg-[#080b18] p-6 text-white shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Upload or record</p><h2 className="mt-2 text-2xl font-black">One continuous video</h2></div>
              <span className="rounded-xl bg-white/10 px-4 py-2 font-mono font-black">{formatTime(elapsedSeconds)} / 1:15</span>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black">
              {previewUrl ? (
                <video className="aspect-video w-full object-cover" controls playsInline src={previewUrl} />
              ) : (
                <div className="relative aspect-video">
                  <video autoPlay className="h-full w-full object-cover [transform:scaleX(-1)]" muted playsInline ref={liveVideoRef} />
                  {!cameraReady && <div className="absolute inset-0 grid place-items-center bg-slate-950 px-6 text-center text-sm text-slate-400">Upload a freshly recorded video, or enable the camera to record here.</div>}
                  {recording && <span className="absolute left-4 top-4 rounded-full bg-rose-600 px-3 py-1 text-xs font-black">● REC</span>}
                </div>
              )}
            </div>

            {!result && <div className="mt-5 flex flex-wrap gap-3">
              {!cameraReady && !recording && (
                <button className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50" disabled={loading || submitting} onClick={() => void enableCamera()} type="button">Enable camera</button>
              )}
              {cameraReady && !recording && <button className="rounded-xl bg-rose-500 px-5 py-3 text-sm font-black" onClick={startRecording} type="button">Start recording</button>}
              {recording && <button className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950" onClick={stopRecording} type="button">Stop recording</button>}
              {!recording && (
                <>
                  <input accept="video/webm,video/mp4,video/quicktime" className="hidden" onChange={(event) => void selectUploadedVideo(event)} ref={fileInputRef} type="file" />
                  <button className="rounded-xl border border-white/20 px-5 py-3 text-sm font-black hover:bg-white/10" disabled={submitting} onClick={() => fileInputRef.current?.click()} type="button">Choose video</button>
                </>
              )}
              {videoFile && <button className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-black disabled:opacity-50" disabled={submitting} onClick={() => void submitIntroduction()} type="button">{submitting ? "Processing…" : "Submit video"}</button>}
              {videoFile && <button className="rounded-xl border border-white/20 px-5 py-3 text-sm font-black" disabled={submitting} onClick={() => void prepareRetake()} type="button">Remove / retake</button>}
            </div>}

            {message && <p aria-live="polite" className="mt-5 rounded-xl bg-white/5 px-4 py-3 text-sm text-slate-200">{message}</p>}
            {errorMessage && <div className="mt-5 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-rose-400/20"><p aria-live="assertive">{errorMessage}</p><button className="mt-3 font-black underline" onClick={() => void prepareRetake()} type="button">Prepare retake</button></div>}

            {result?.question_answers && (
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-black">Answer timing</h3><span className="text-sm text-slate-300">{result.timing_summary?.within_time_limit_count ?? 0}/10 within 5s</span></div>
                <div className="mt-4 space-y-2">
                  {result.question_answers.map((answer) => (
                    <div className="rounded-xl bg-white/5 px-4 py-3" key={answer.question_number}>
                      <div className="flex items-center justify-between gap-4"><p className="font-bold">Question {answer.question_number}</p><span className={answer.within_time_limit ? "text-emerald-300" : "text-amber-300"}>{answer.duration_seconds.toFixed(1)}s {answer.within_time_limit ? "✓" : "over 5s"}</span></div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{answer.transcript}</p>
                    </div>
                  ))}
                </div>
                <button className="mt-5 w-full rounded-xl bg-indigo-500 px-5 py-3 font-black" onClick={() => router.push(`/mock-interview?student_id=${studentId}`)} type="button">Continue to mock interview</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
