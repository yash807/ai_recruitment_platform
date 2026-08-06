"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  createMediaRecorder,
  getBackendMediaUrl,
  isFetchConnectionError,
  mediaRequestErrorMessage,
} from "../backend-media";

// Small API calls use the Next.js proxy; video files upload directly to FastAPI.
const API_URL = "/api";

// Small student profile displayed before the interview starts.
type Student = {
  id: number;
  name: string;
  email: string;
  resume_score: number;
  target_role: string | null;
  role_match_score: number;
};

// Interview session returned by the backend.
type InterviewSession = {
  id: number;
  student_id: number;
  questions: string[];
  recorded_question_indexes: number[];
  status: string;
  analysis_status: string;
  overall_score: number;
};

// Response returned after saving one video answer.
type VideoAnswerResult = {
  message: string;
  interview_id: number;
  question_index: number;
  recorded_question_indexes: number[];
  status: string;
};

// Structured Day 4 result returned after transcription and AI evaluation.
type AnswerEvaluation = {
  question_index: number;
  relevance_score: number;
  technical_score: number;
  communication_score: number;
  feedback: string;
};

type InterviewEvaluation = {
  target_role: string;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  project_understanding_score: number;
  role_readiness_score: number;
  overall_score: number;
  strengths: string[];
  improvement_areas: string[];
  improvement_plan: string[];
  summary: string;
  answer_evaluations: AnswerEvaluation[];
};

type InterviewAnalysis = {
  interview_id: number;
  analysis_status: string;
  transcripts: string[];
  evaluation: InterviewEvaluation;
};

export default function MockInterviewPage() {
  // Current student and interview progress.
  const [student, setStudent] = useState<Student | null>(null);
  const [interview, setInterview] = useState<InterviewSession | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  // Browser media objects are stored in refs because they should not
  // cause the React page to rerender whenever they change.
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Read student_id from the URL and load that single student.
  useEffect(() => {
    async function loadCurrentStudent() {
      const studentId = new URLSearchParams(window.location.search).get(
        "student_id",
      );
      if (!studentId) {
        setMessage(
          "No student profile was provided. Return to the student workspace and start the interview from a profile.",
        );
        return;
      }

      try {
        const response = await fetch(`${API_URL}/students/${studentId}`);
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.detail || "Could not load the student profile.");
        }
        setStudent(result);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load the student profile.",
        );
      }
    }

    void loadCurrentStudent();
    // Stop camera and microphone if the user leaves the page.
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Release old preview URLs to avoid unnecessary browser memory use.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Ask FastAPI to create a five-question interview for this student.
  async function startInterview() {
    if (!student) {
      setMessage("Open the interview from a valid student profile first.");
      return;
    }

    setMessage("");
    try {
      const response = await fetch(
        `${API_URL}/mock-interviews/start/${student.id}`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not start the interview.");
      }

      setInterview(result);
      setCurrentQuestionIndex(0);
      setPreviewUrl("");
      setMessage("Interview started. Enable your camera and microphone when ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the interview.");
    }
  }

  // Request camera and microphone permission from the browser.
  async function enableCamera() {
    setMessage("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera and microphone recording is not supported in this browser.");
      }

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
      setMessage("Camera and microphone are ready.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Camera or microphone permission was not granted.",
      );
    }
  }

  // Convert the recorded Blob into a File and upload it to FastAPI.
  async function uploadRecordedAnswer(blob: Blob, mimeType: string) {
    if (!interview) return;

    setUploading(true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(blob));
    try {
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const videoFile = new File(
        [blob],
        `question-${currentQuestionIndex + 1}.${extension}`,
        { type: mimeType },
      );
      const uploadData = new FormData();
      uploadData.append("video", videoFile);

      const uploadUrl = await getBackendMediaUrl(
        `/mock-interviews/${interview.id}/answers/${currentQuestionIndex}`,
      );
      const response = await fetch(
        uploadUrl,
        {
          method: "POST",
          body: uploadData,
        },
      );
      const result: VideoAnswerResult & { detail?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not save the recorded answer.");
      }

      setInterview((current) =>
        current
          ? {
              ...current,
              recorded_question_indexes: result.recorded_question_indexes,
              status: result.status,
            }
          : current,
      );

      if (result.status === "Completed") {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setCameraReady(false);
        setMessage("Mock interview completed. All five video answers were saved.");
      } else {
        setCurrentQuestionIndex((current) => current + 1);
        setMessage("Answer saved. Continue with the next question.");
      }
    } catch (error) {
      if (isFetchConnectionError(error)) {
        try {
          const recoveryResponse = await fetch(
            `${API_URL}/mock-interviews/${interview.id}`,
            { cache: "no-store" },
          );
          if (recoveryResponse.ok) {
            const recovered: InterviewSession = await recoveryResponse.json();
            if (
              recovered.recorded_question_indexes.includes(
                currentQuestionIndex,
              )
            ) {
              setInterview(recovered);
              if (recovered.status === "Completed") {
                streamRef.current?.getTracks().forEach((track) => track.stop());
                setCameraReady(false);
                setMessage(
                  "Answer saved. The upload response disconnected, but all five answers were recovered from the server.",
                );
              } else {
                setCurrentQuestionIndex((current) => current + 1);
                setMessage(
                  "Answer saved. The upload response disconnected, so progress was recovered from the server.",
                );
              }
              return;
            }
          }
        } catch {
          // Show the shared connection message when recovery is also unavailable.
        }
      }
      setMessage(
        mediaRequestErrorMessage(error, "Could not save the answer."),
      );
    } finally {
      setUploading(false);
    }
  }

  // Create MediaRecorder and begin collecting video/audio chunks.
  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setMessage("Enable the camera and microphone first.");
      return;
    }

    const preferredMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

    chunksRef.current = [];
    const recorder = createMediaRecorder(stream, preferredMimeType);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: preferredMimeType });
      void uploadRecordedAnswer(blob, preferredMimeType);
    };
    recorder.start();
    setRecording(true);
    setMessage("Recording your answer...");
  }

  // Stop MediaRecorder; its onstop handler uploads the completed Blob.
  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecording(false);
      setMessage("Recording stopped. Saving your answer...");
    }
  }

  // Ask FastAPI to transcribe and evaluate all five saved recordings.
  async function analyzeInterview() {
    if (!interview) return;

    setAnalyzing(true);
    setMessage(
      "Analysis is running on the video-processing server. Five recordings are being transcribed and evaluated...",
    );
    try {
      // Analysis can take longer than Vercel's function limit because Render
      // transcribes five videos. Call FastAPI directly instead of proxying the
      // request through the Next.js serverless route.
      const analysisUrl = await getBackendMediaUrl(
        `/mock-interviews/${interview.id}/analyze`,
      );
      const response = await fetch(
        analysisUrl,
        { method: "POST" },
      );
      const responseText = await response.text();
      let result: InterviewAnalysis & { detail?: string };
      try {
        result = JSON.parse(responseText) as InterviewAnalysis & {
          detail?: string;
        };
      } catch {
        throw new Error(
          response.ok
            ? "The backend returned an invalid analysis response."
            : responseText || "The backend could not analyze the interview.",
        );
      }
      if (!response.ok) {
        throw new Error(result.detail || "Could not analyze the interview.");
      }

      setAnalysis(result);
      setInterview((current) =>
        current
          ? {
              ...current,
              analysis_status: result.analysis_status,
              overall_score: result.evaluation.overall_score,
            }
          : current,
      );
      setMessage("Readiness profile created and saved to the student profile.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not analyze the interview.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const currentQuestion = interview?.questions[currentQuestionIndex];
  const completed = interview?.status === "Completed";

  return (
    <main className="brand-dark-shell relative min-h-screen overflow-hidden bg-[#080b18] px-5 py-7 text-white sm:px-8">
      {/* Dark interview-room background */}
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-10 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        {/* Interview navigation and security label */}
        <nav className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
          <Link className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white" href="/">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">←</span> Student workspace
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Secure practice mode
          </span>
        </nav>

        {/* Interview explanation */}
        <header className="fade-up mt-9">
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-300">
            Practice interview
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Mock AI video interview</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Record five role-based answers, then create a transcript-backed AI
            readiness profile with scores and practical improvement advice.
          </p>
        </header>

        {/* Automatically loaded student and start button */}
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.055] p-6 shadow-2xl backdrop-blur-xl">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Current student
              </p>
              {student ? (
                <>
                  <h2 className="mt-2 text-xl font-bold">{student.name}</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    {student.target_role || "No target role"} · ATS{" "}
                    {student.resume_score}/100 · Role match{" "}
                    {student.role_match_score}/100
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  Open this page using the interview button on a student profile.
                </p>
              )}
            </div>
            <button
              className="rounded-xl bg-indigo-500 px-5 py-3 font-bold shadow-lg shadow-indigo-950 hover:-translate-y-0.5 hover:bg-indigo-400 disabled:opacity-50"
              disabled={Boolean(interview) || !student}
              onClick={startInterview}
              type="button"
            >
              Start mock interview
            </button>
          </div>

          {message && (
            <p className="mt-4 rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-200">{message}</p>
          )}
        </section>

        {/* Question panel and video recorder appear after the session starts */}
        {interview && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <span>Interview #{interview.id}</span>
                <span>{interview.recorded_question_indexes.length}/5 saved</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400 transition-all duration-500" style={{ width: `${(interview.recorded_question_indexes.length / 5) * 100}%` }} />
              </div>

              {completed ? (
                <div className="mt-8 rounded-xl bg-emerald-500/10 p-6 text-center ring-1 ring-emerald-400/30">
                  <p className="text-4xl">✓</p>
                  <h2 className="mt-3 text-xl font-bold text-emerald-300">Interview completed</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    All five video answers are saved. Start local analysis to
                    transcribe and evaluate them for {student?.target_role}.
                  </p>
                  <button
                    className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-950/50 hover:-translate-y-0.5 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
                    disabled={analyzing}
                    onClick={analyzeInterview}
                    type="button"
                  >
                    {analyzing
                      ? "Analyzing interview..."
                      : analysis
                        ? "View saved analysis"
                        : "Analyze interview"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-8 text-sm font-semibold text-indigo-300">
                    Question {currentQuestionIndex + 1} of {interview.questions.length}
                  </p>
                  <h2 className="mt-3 text-2xl font-bold leading-9">{currentQuestion}</h2>
                  <p className="mt-5 text-sm leading-6 text-slate-400">
                    Think briefly, then record a clear answer. Stop recording when you finish; the video will upload automatically.
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
                  <span className={`h-2 w-2 rounded-full ${recording ? "animate-pulse bg-red-500" : cameraReady ? "bg-emerald-400" : "bg-slate-500"}`} />
                  {recording ? "REC" : cameraReady ? "Camera ready" : "Camera off"}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {!cameraReady && !completed && (
                  <button
                    className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 shadow-lg hover:-translate-y-0.5 hover:bg-indigo-50"
                    onClick={enableCamera}
                    type="button"
                  >
                    Enable camera and microphone
                  </button>
                )}
                {cameraReady && !recording && !completed && (
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
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-300">Last saved answer preview</h3>
                  <video className="mt-2 w-full rounded-lg" controls playsInline src={previewUrl} />
                </div>
              )}
            </section>
          </div>
        )}

        {/* Day 4 result: scores, profile feedback, and answer evidence. */}
        {analysis && (
          <section className="fade-up mt-8 rounded-3xl border border-indigo-300/20 bg-gradient-to-br from-indigo-500/15 to-cyan-400/5 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-indigo-300">
                  Local AI readiness profile
                </p>
                <h2 className="mt-2 text-3xl font-black">
                  {analysis.evaluation.target_role}
                </h2>
                <p className="mt-3 max-w-3xl leading-7 text-slate-300">
                  {analysis.evaluation.summary}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 px-6 py-4 text-center ring-1 ring-white/15">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Overall
                </p>
                <p className="mt-1 text-4xl font-black text-cyan-300">
                  {analysis.evaluation.overall_score}
                </p>
                <p className="text-xs text-slate-400">out of 100</p>
              </div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Technical", analysis.evaluation.technical_score],
                ["Communication", analysis.evaluation.communication_score],
                ["Problem solving", analysis.evaluation.problem_solving_score],
                [
                  "Project knowledge",
                  analysis.evaluation.project_understanding_score,
                ],
                ["Role readiness", analysis.evaluation.role_readiness_score],
              ].map(([label, score]) => (
                <div
                  className="rounded-2xl bg-black/20 p-4 ring-1 ring-white/10"
                  key={label}
                >
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-black">{score}/100</p>
                </div>
              ))}
            </div>

            <div className="mt-7 grid gap-5 md:grid-cols-3">
              {[
                ["Strengths", analysis.evaluation.strengths, "text-emerald-300"],
                [
                  "Improve next",
                  analysis.evaluation.improvement_areas,
                  "text-amber-300",
                ],
                [
                  "Action plan",
                  analysis.evaluation.improvement_plan,
                  "text-cyan-300",
                ],
              ].map(([title, items, color]) => (
                <div
                  className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10"
                  key={title as string}
                >
                  <h3 className={`font-bold ${color}`}>{title as string}</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                    {(items as string[]).map((item) => (
                      <li className="flex gap-2" key={item}>
                        <span className="text-slate-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-7">
              <h3 className="text-xl font-bold">Answer-by-answer evidence</h3>
              <p className="mt-1 text-sm text-slate-400">
                A local Whisper model creates the transcript. Transparent rules
                score its role relevance and evidence—not facial appearance,
                emotion, accent, or other sensitive traits.
              </p>
              <div className="mt-4 space-y-4">
                {analysis.evaluation.answer_evaluations
                  .slice()
                  .sort((a, b) => a.question_index - b.question_index)
                  .map((answer) => (
                    <article
                      className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10"
                      key={answer.question_index}
                    >
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">
                        Question {answer.question_index + 1}
                      </p>
                      <p className="mt-2 font-semibold">
                        {interview?.questions[answer.question_index]}
                      </p>
                      <p className="mt-3 rounded-xl bg-white/5 p-3 text-sm leading-6 text-slate-300">
                        <span className="font-bold text-slate-200">
                          Transcript:
                        </span>{" "}
                        {analysis.transcripts[answer.question_index] ||
                          "No speech was detected."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-white/10 px-3 py-1.5">
                          Relevance {answer.relevance_score}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5">
                          Technical {answer.technical_score}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5">
                          Communication {answer.communication_score}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {answer.feedback}
                      </p>
                    </article>
                  ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
