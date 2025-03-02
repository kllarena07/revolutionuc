import { NextRequest } from "next/server";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";

// Configure AWS client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

// S3 bucket for storing notebooks and logs
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "current-sagemaker-notebooks";

/**
 * Convert a Node.js Readable stream to a Web ReadableStream
 */
function nodeReadableToWebReadable(nodeReadable: Readable): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeReadable.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      nodeReadable.on("end", () => {
        controller.close();
      });
      nodeReadable.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeReadable.destroy();
    },
  });
}

/**
 * Format data as a Server-Sent Event
 */
function formatSSE(data: string | object, event?: string): string {
  const formattedData = typeof data === "object" ? JSON.stringify(data) : data;
  let message = "";

  if (event) {
    message += `event: ${event}\n`;
  }

  // Split the data by newlines and format each line
  const lines = formattedData.split("\n");
  for (const line of lines) {
    message += `data: ${line}\n`;
  }

  return message + "\n";
}

export async function GET(request: NextRequest) {
  // Extract jobId from the query parameters
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const logType = searchParams.get("type") || "cell_output"; // 'execution' or 'cell_output'

  if (!jobId) {
    return new Response(formatSSE({ error: "jobId is required" }, "error"), {
      status: 400,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Log file path in S3
  const logKey = `logs/${jobId}/${logType}.log`;

  try {
    // Check if the log file exists first
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: logKey,
        })
      );
    } catch (error) {
      return new Response(
        formatSSE({ error: `Log file not found for job ${jobId}` }, "error"),
        {
          status: 404,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
    }

    // Stream the response
    let lastPosition = 0;
    let isJobComplete = false;

    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        // Send initial message
        controller.enqueue(
          new TextEncoder().encode(
            formatSSE(
              { message: `Starting log stream for job ${jobId}` },
              "info"
            )
          )
        );

        // Poll the log file every few seconds until the job completes
        while (!isJobComplete) {
          try {
            // Get the object
            const response = await s3Client.send(
              new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: logKey,
                Range: `bytes=${lastPosition}-`, // Get only new content
              })
            );

            // Process the log content
            if (response.Body) {
              const readable = response.Body as Readable;
              const chunks: Buffer[] = [];

              for await (const chunk of readable) {
                chunks.push(Buffer.from(chunk));
              }

              const newContent = Buffer.concat(chunks).toString("utf-8");

              if (newContent.length > 0) {
                // Update the last position
                lastPosition += newContent.length;

                // Send the new content
                controller.enqueue(
                  new TextEncoder().encode(formatSSE(newContent, "log"))
                );

                // Check if the job is complete
                if (
                  newContent.includes("Notebook execution completed") ||
                  newContent.includes("Error executing notebook")
                ) {
                  isJobComplete = true;
                  controller.enqueue(
                    new TextEncoder().encode(
                      formatSSE({ status: "complete" }, "status")
                    )
                  );
                }
              }
            }
          } catch (error) {
            console.error(`Error streaming logs for job ${jobId}:`, error);
            // Don't abort on error, just log it and continue
          }

          // If job is not complete, wait before polling again
          if (!isJobComplete) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        // Close the stream when done
        controller.close();
      },
    });

    // Return the streaming response
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error(`Error streaming logs for job ${jobId}:`, error);

    let errorMessage = "Failed to stream notebook logs";
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return new Response(formatSSE({ error: errorMessage }, "error"), {
      status: 500,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}
