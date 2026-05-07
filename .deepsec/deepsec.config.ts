import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { defineConfig, type DeepsecPlugin } from "deepsec/config";

type AgentProgress = {
  type: "started" | "thinking" | "tool_use" | "error" | "complete";
  message: string;
  candidateFile?: string;
};

type InnerPcConfig = {
  model?: string;
  maxTurns?: number;
};

function extractJsonText(text: string) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  return jsonMatch ? jsonMatch[1].trim() : text.trim();
}

function parseInnerPcOutput(stdout: string) {
  try {
    const parsed = JSON.parse(stdout);
    return String(parsed.result ?? parsed.response ?? parsed.output ?? parsed.message ?? stdout);
  } catch {
    return stdout;
  }
}

function resolveGitBashPath() {
  const candidates = [
    process.env.INNERCC_GIT_BASH_PATH,
    "D:\\Git\\bin\\bash.exe"
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate));
}

async function runInnerPc(prompt: string, cwd: string, config: InnerPcConfig = {}) {
  const exe = "D:\\inner-cc\\inner-pc.exe";
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--model",
    config.model ?? "gpt-5.5",
    "--effort",
    "max",
    prompt,
  ];

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      env: {
        ...process.env,
        ...(resolveGitBashPath() ? { INNERCC_GIT_BASH_PATH: resolveGitBashPath() } : {}),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `inner-pc exited with code ${code}`));
        return;
      }
      resolve(parseInnerPcOutput(stdout));
    });
  });
}

const innerPcPlugin: DeepsecPlugin = {
  name: "inner-pc-agent",
  agents: [
    {
      type: "inner-pc",

      async *investigate(params: any): AsyncGenerator<AgentProgress, any> {
        const start = Date.now();
        const model = params.config?.model ?? "gpt-5.5";

        yield {
          type: "started",
          message: `Investigating ${params.batch.length} file(s) with inner-pc (${model})`,
        };

        const prompt = `${params.promptTemplate}

${params.projectInfo ? `## Project Context\n\n${params.projectInfo}\n\n` : ""}## InnerPC Runtime Notes

- Project root: ${params.projectRoot}
- Target file paths are relative to that root.
- Read files from disk as needed.
- Return the DeepSec result as a single fenced json block or raw JSON array.`;

        const text = await runInnerPc(prompt, params.projectRoot, params.config);
        const jsonText = extractJsonText(text);
        let parsed: any[] = [];
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          parsed = [];
        }

        const batchPaths = new Set(params.batch.map((r: any) => r.filePath));
        const results = parsed
          .filter((r) => batchPaths.has(r?.filePath))
          .map((r) => ({ filePath: r.filePath, findings: r.findings ?? [] }));

        for (const record of params.batch) {
          if (!results.some((r) => r.filePath === record.filePath)) {
            results.push({ filePath: record.filePath, findings: [] });
          }
        }

        yield {
          type: "complete",
          message: `Investigation complete with inner-pc (${results.length} analyses)`,
        };

        return {
          results,
          meta: {
            durationMs: Date.now() - start,
            agentSessionId: "inner-pc",
          },
        };
      },

      async *revalidate(params: any): AsyncGenerator<AgentProgress, any> {
        const start = Date.now();
        const model = params.config?.model ?? "gpt-5.5";
        const findings = params.batch.flatMap((file: any) =>
          (file.findings ?? [])
            .filter((finding: any) => params.force || !finding.revalidation)
            .map((finding: any) => ({ filePath: file.filePath, ...finding })),
        );

        yield {
          type: "started",
          message: `Revalidating ${findings.length} finding(s) with inner-pc (${model})`,
        };

        const prompt = `You are revalidating DeepSec vulnerability findings using static analysis only.

Project root: ${params.projectRoot}

For each finding, read the relevant source and return ONLY a JSON array. Each item must have:
- filePath
- title
- verdict: "true-positive" | "false-positive" | "fixed" | "uncertain"
- reasoning
- optional adjustedSeverity

Findings:
${JSON.stringify(findings, null, 2)}`;

        const text = await runInnerPc(prompt, params.projectRoot, params.config);
        const jsonText = extractJsonText(text);
        let verdicts: any[] = [];
        try {
          verdicts = JSON.parse(jsonText);
        } catch {
          verdicts = [];
        }

        yield {
          type: "complete",
          message: `Revalidation complete with inner-pc (${verdicts.length} verdicts)`,
        };

        return {
          verdicts,
          meta: {
            durationMs: Date.now() - start,
            agentSessionId: "inner-pc",
          },
        };
      },
    } as any,
  ],
};

export default defineConfig({
  projects: [
    { id: "opencode", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [innerPcPlugin],
});
