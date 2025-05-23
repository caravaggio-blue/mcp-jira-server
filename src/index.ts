#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs";
import path from "path";

const JIRA_EMAIL = process.env.JIRA_EMAIL as string;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN as string;
const JIRA_DOMAIN = process.env.JIRA_DOMAIN as string;
const DEFAULT_PROJECT_KEY = process.env.DEFAULT_PROJECT_KEY as string;

if (!JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_DOMAIN || !DEFAULT_PROJECT_KEY) {
  throw new Error(
    "JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_DOMAIN environment variables are required"
  );
}

interface JiraConfig {
  projectKey: string;
}

interface JiraComment {
  id: string;
  body: string;
  created: string;
  author: {
    displayName: string;
  };
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: string;
    status: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    created: string;
    creator: {
      displayName: string;
    };
    comment?: {
      comments: JiraComment[];
    };
  };
}

class JiraServer {
  private server: Server;
  private axiosInstance;
  private currentProjectKey: string | null = null;

  constructor() {
    this.server = new Server(
      {
        name: "jira-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: `https://${JIRA_DOMAIN}.atlassian.net/rest/api/2`,
      auth: {
        username: JIRA_EMAIL,
        password: JIRA_API_TOKEN,
      },
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  private formatIssue(issue: JiraIssue): string {
    let output = `${issue.key}: ${issue.fields.summary}
- Type: ${issue.fields.issuetype.name}
- Status: ${issue.fields.status.name}
- Created: ${this.formatDate(issue.fields.created)}
- Description: ${issue.fields.description || "No description"}
- Creator: ${issue.fields.creator.displayName}`;

    const comments = issue.fields.comment?.comments;
    if (comments && comments.length > 0) {
      output += "\n\nComments:";
      comments.forEach((comment) => {
        output += `\n\n[${this.formatDate(comment.created)} by ${
          comment.author.displayName
        }]\n${comment.body}`;
      });
    }

    return output;
  }

  private formatIssueList(issues: JiraIssue[]): string {
    if (issues.length === 0) {
      return "No issues found.";
    }

    const formattedIssues = issues
      .map((issue) => this.formatIssue(issue))
      .join("\n");
    return `Latest Jira Issues in ${this.currentProjectKey} Project:\n\n${formattedIssues}\nTotal Issues: ${issues.length}`;
  }

  private formatCreatedIssue(issue: any): string {
    return `Issue created successfully:
- Key: ${issue.key}
- URL: https://${JIRA_DOMAIN}.atlassian.net/browse/${issue.key}`;
  }


  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "create_issue",
          description: "Create a new Jira issue",
          inputSchema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "Issue summary/title",
              },
              description: {
                type: "string",
                description: "Issue description",
              },
              type: {
                type: "string",
                description: "Issue type (Task, Epic, or Subtask)",
              },
            },
            required: ["summary", "description", "type"],
          },
        },
        {
          name: "list_issues",
          description: "List issues in the project",
          inputSchema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                description:
                  'Filter by status (e.g., "To Do", "In Progress", "Done")',
              },
            },
            required: [],
          },
        },
        {
          name: "update_issue",
          description: "Update an existing issue",
          inputSchema: {
            type: "object",
            properties: {
              
              issue_key: {
                type: "string",
                description: "Issue key (e.g., PRJ-123)",
              },
              summary: {
                type: "string",
                description: "New summary/title",
              },
              description: {
                type: "string",
                description: "New description",
              },
              status: {
                type: "string",
                description: "New status",
              },
            },
            required: ["issue_key"],
          },
        },
        {
          name: "get_issue",
          description: "Get details of a specific issue",
          inputSchema: {
            type: "object",
            properties: {
              issue_key: {
                type: "string",
                description: "Issue key (e.g., PRJ-123)",
              },
            },
            required: ["issue_key"],
          },
        },
        {
          name: "delete_issue",
          description: "Delete a Jira issue",
          inputSchema: {
            type: "object",
            properties: {
              issue_key: {
                type: "string",
                description: "Issue key (e.g., PRJ-123)",
              },
            },
            required: ["issue_key"],
          },
        },
        {
          name: "add_comment",
          description: "Add a comment to an existing issue",
          inputSchema: {
            type: "object",
            properties: {
              issue_key: {
                type: "string",
                description: "Issue key (e.g., PRJ-123)",
              },
              comment: {
                type: "string",
                description: "Comment text to add to the issue",
              },
            },
            required: ["issue_key", "comment"],
          },
        },
        {
          name: "search_issues",
          description: "Search issues using a custom JQL query",
          inputSchema: {
            type: "object",
            properties: {
              jql: {
                type: "string",
                description: "JQL query string (e.g., 'project = PROJ AND status = \"In Progress\" ORDER BY created DESC')",
              }
            },
            required: ["jql"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { working_dir, ...args } = request.params.arguments as any;
        this.currentProjectKey = await DEFAULT_PROJECT_KEY;

        switch (request.params.name) {
          case "create_issue": {
            const { summary, description, type } = args;

            console.error("Creating issue with:", {
              projectKey: this.currentProjectKey,
              summary,
              description,
              type,
            });

            // First, get project metadata to verify it exists and get available issue types
            const metaResponse = await this.axiosInstance.get(
              "/issue/createmeta",
              {
                params: {
                  projectKeys: this.currentProjectKey,
                  expand: "projects.issuetypes",
                },
              }
            );

            console.error(
              "Project metadata:",
              JSON.stringify(metaResponse.data, null, 2)
            );

            const project = metaResponse.data.projects[0];
            if (!project) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Project ${this.currentProjectKey} not found`
              );
            }

            const issueType = project.issuetypes.find(
              (t: any) => t.name.toLowerCase() === type.toLowerCase()
            );
            if (!issueType) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Issue type "${type}" not found. Available types: ${project.issuetypes
                  .map((t: any) => t.name)
                  .join(", ")}`
              );
            }

            const createResponse = await this.axiosInstance.post("/issue", {
              fields: {
                project: {
                  key: this.currentProjectKey,
                },
                summary,
                description,
                issuetype: {
                  id: issueType.id,
                },
              },
            });

            return {
              content: [
                {
                  type: "text",
                  text: this.formatCreatedIssue(createResponse.data),
                },
              ],
            };
          }

          case "list_issues": {
            const { status } = args;
            const jql = status
              ? `project = ${this.currentProjectKey} AND status = "${status}" ORDER BY created DESC`
              : `project = ${this.currentProjectKey} ORDER BY created DESC`;

            const searchResponse = await this.axiosInstance.get("/search", {
              params: {
                jql,
                fields: [
                  "summary",
                  "description",
                  "status",
                  "issuetype",
                  "created",
                  "creator",
                  "assignee",
                ],
              },
            });

            return {
              content: [
                {
                  type: "text",
                  text: this.formatIssueList(searchResponse.data.issues),
                },
              ],
            };
          }

          case "update_issue": {
            const { issue_key, summary, description, status } = args;
            const updateData: any = {
              fields: {},
            };

            if (summary) updateData.fields.summary = summary;
            if (description) updateData.fields.description = description;
            if (status) {
              const transitions = await this.axiosInstance.get(
                `/issue/${issue_key}/transitions`
              );
              const transition = transitions.data.transitions.find(
                (t: any) => t.name.toLowerCase() === status.toLowerCase()
              );
              if (transition) {
                await this.axiosInstance.post(
                  `/issue/${issue_key}/transitions`,
                  {
                    transition: { id: transition.id },
                  }
                );
              }
            }

            if (Object.keys(updateData.fields).length > 0) {
              await this.axiosInstance.put(`/issue/${issue_key}`, updateData);
            }

            const updatedIssue = await this.axiosInstance.get(
              `/issue/${issue_key}`
            );
            return {
              content: [
                {
                  type: "text",
                  text: this.formatIssue(updatedIssue.data),
                },
              ],
            };
          }

          case "get_issue": {
            const { issue_key } = args;
            const getResponse = await this.axiosInstance.get(
              `/issue/${issue_key}`,
              {
                params: {
                  expand:
                    "renderedFields,names,schema,transitions,operations,editmeta,changelog,comments",
                  fields:
                    "summary,description,status,issuetype,created,creator,comment",
                },
              }
            );
            return {
              content: [
                {
                  type: "text",
                  text: this.formatIssue(getResponse.data),
                },
              ],
            };
          }

          case "delete_issue": {
            const { issue_key } = args;
            await this.axiosInstance.delete(`/issue/${issue_key}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Issue ${issue_key} has been deleted.`,
                },
              ],
            };
          }

          case "add_comment": {
            const { issue_key, comment } = args;
            await this.axiosInstance.post(`/issue/${issue_key}/comment`, {
              body: comment,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Comment added to issue ${issue_key}`,
                },
              ],
            };
          }

          case "search_issues": {
            const { jql } = args;

            const searchResponse = await this.axiosInstance.get("/search", {
              params: {
                jql,
                fields: [
                  "summary",
                  "status",
                  "issuetype",
                  "created",
                  "updated",
                  "creator",
                  "reporter",
                  "assignee"
                ],
              },
            });

            return {
              content: [
                {
                  type: "text",
                  text: this.formatIssueList(searchResponse.data.issues),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Jira API Error:", {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
          });
          throw new McpError(
            ErrorCode.InternalError,
            `Jira API error: ${JSON.stringify(
              error.response?.data ?? error.message
            )}`
          );
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jira MCP server running on stdio");
  }
}

const server = new JiraServer();
server.run().catch(console.error);
