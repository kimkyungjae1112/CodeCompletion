// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
// plz 'npm install' initial of cloneproject
import * as vscode from "vscode";
import * as path from "path";
import OpenAI from "openai";
import { CSnippetGenerator } from "./cSnippetGenerator";

// document : Open text document in VSCode
// position : Current cursor position
// token : Whether the operation was canceled
// context : Context in which code completion is provided
// sendMessage : Text length
// cursorindex : Cursor position
// textArea : Entire text
let CompletionProvider: any;
let candidatesData: CompletionItem[];
let cSnippetGenerator: CSnippetGenerator | null = null; // What's changed
let linePrefix: string;
let resulted_prefix: string;
let responseText: string | null = null;
let candidate_list: string[] = []; 

type CompletionItem = {
  key: string;
  value: number;
  sortText: string;
};

// -- ChatGPT API Code --
const openai = new OpenAI({
  organization: "",
  apiKey:
    "",
});

// (Temporary) Fine Tuning Code
async function generativeAIcommunication(message: string) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "user", content: message }],
    model: "gpt-3.5-turbo-0125",
  });

  const response = completion.choices[0].message.content;
  return response;
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Running the VSC Extension");
  cSnippetGenerator = new CSnippetGenerator("", "", "");

  // --- Candidate Code Completion Code ---
  // Command that displays a list of candidates using the candidates received after communicating with the server.
  const completionCommand = vscode.commands.registerCommand(
    "extension.subhotkey",
    () => {
      // Delete existing Completion
      const disposable = vscode.Disposable.from(CompletionProvider);
      disposable.dispose();

      // Register a new Completion
      CompletionProvider = vscode.languages.registerCompletionItemProvider(
        ["c"],
        {
          provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
          ): vscode.ProviderResult<
            vscode.CompletionItem[] | vscode.CompletionList
          > {
            const completionItems: vscode.CompletionItem[] = [];
            for (const { key, value, sortText } of candidatesData) {
              // completion: means one candidate.
              const completion = new vscode.CompletionItem(key.trim());
              console.log("completion value:", completion);

              // The value from the user's cursor position to the space
              // ex) If 'IF a = 10', it becomes 10, if 'IF a = 10 ', it becomes ''.
              linePrefix = document
                .lineAt(position)
                .text.slice(0, position.character);

              // sortText to sort the phrase candidates by frequency
              completion.sortText = sortText;

              // Set the frequency for each phrase group to be output as Docs
              const completionDocs = new vscode.MarkdownString(
                "Frequency : " + value
              );
              // Writing documentation for Completion
              completion.documentation = completionDocs;
              // Code suggestion Code to prevent filtering by prefix
              completion.filterText = linePrefix;
              completionItems.push(completion);
            }
            ``;
            return completionItems;
          },
          async resolveCompletionItem(item: vscode.CompletionItem) {
            console.log("Execute the resolve function");

            // In the case of Graphics.Window, only Window should be the prefix.
           // The area after the '.' position is taken as the prefix.

            if (item && cSnippetGenerator !== null) {
              const lastIndex = linePrefix.length - 1;
              let insertText: string | null;
              // linePrefix: If there is no code being hit
              if (linePrefix[lastIndex] === " ") {
                insertText = await cSnippetGenerator.getInsertText(
                  item.label,
                  "codecompletion"
                );
              } else {
                const lastDotIndex = linePrefix.lastIndexOf(".");
                if (lastDotIndex !== -1) {
                  linePrefix = linePrefix.slice(lastDotIndex + 1).trim();
                }
                insertText =
                  linePrefix +
                  (await cSnippetGenerator.getInsertText(
                    item.label,
                    "codecompletion"
                  ));
              }
              if (insertText === null) {
                insertText = "";
              }
              item.insertText = new vscode.SnippetString(insertText.trim());
            }
            return item;
          },
        }
      );
      // Execute Triggest Suggest
      vscode.commands.executeCommand("editor.action.triggerSuggest");
    }
  );

  context.subscriptions.push(completionCommand);

// 완성 코드 !! 
// 사용자가 1초 이상 입력이 없으면 구문 추천
// --- 회색 추천 텍스트 기능 ---
let ghostTextDecorationType: vscode.TextEditorDecorationType | null = null;
let currentGhostText: string | undefined = undefined;
let previousDecorationRange: vscode.Range | null = null;
let currentIndex = 0; // 현재 선택된 completionItems 배열의 인덱스를 추적
let completionItems: any[] | null = null; // 추천 항목을 저장
let isUpdating = false; // 추천 항목 업데이트 중 여부를 추적
let typingTimer: NodeJS.Timeout | null = null; // 타이핑 타이머
const typingDelay = 1000; // 1초 지연

// Ghost Text 제거 함수 (입력 변경 시 초기화)
function clearGhostText() {
  if (ghostTextDecorationType) {
    ghostTextDecorationType.dispose();
    ghostTextDecorationType = null;
    previousDecorationRange = null;
  }
  currentGhostText = undefined;
  completionItems = null;
}

// 텍스트 변경 및 커서 이동 이벤트 핸들러
vscode.workspace.onDidChangeTextDocument(
  async (event) => {
    const editor = vscode.window.activeTextEditor;

    if (!editor || event.document !== editor.document) {
      return;
    }
    
    const cursorPosition = editor.selection.active;

    // 텍스트 변경 시 Ghost Text 초기화
    clearGhostText();
    
    // 타이핑 타이머 초기화 및 시작
    if (typingTimer) {
      clearTimeout(typingTimer);
    }
    typingTimer = setTimeout(() => {
      if (!isUpdating) {
        handleGhostTextUpdate(editor);
      }
    }, typingDelay);
  },
  null,
  context.subscriptions
);

vscode.window.onDidChangeTextEditorSelection(
  (event) => {
    const editor = event.textEditor;

    // 커서 이동 시 Ghost Text 초기화
    clearGhostText();

    if (!isUpdating && typingTimer === null) {
      handleGhostTextUpdate(editor);
    }
  },
  null,
  context.subscriptions
);

// Ghost Text 업데이트 로직
async function handleGhostTextUpdate(editor: vscode.TextEditor) {
  isUpdating = true; // 업데이트 중 플래그 설정

  const cursorPosition = editor.selection.active;
  const document = editor.document;

  const cursorOffset = document.offsetAt(cursorPosition);
  const frontCursorText = document.getText().substring(0, cursorOffset);
  const backCursorText = document.getText().substring(cursorOffset);

  // 추천 항목 생성기를 초기화
  const snippetGenerator = new CSnippetGenerator(
    `${document.getText().length.toString()} True`,
    frontCursorText,
    backCursorText
  );

  // 추천 항목 가져오기
  snippetGenerator.getCompletionItems();
  snippetGenerator.onDataReceived((items: any[]) => {
    isUpdating = false; // 업데이트 완료 플래그 해제

    if (!items || items.length === 0) {
      clearGhostText();
      return;
    }

    // 추천 항목 갱신
    completionItems = items;
    currentIndex = 0;
    updateGhostText(editor, cursorPosition);
  });
}

// Ghost Text 업데이트 함수
function updateGhostText(editor: vscode.TextEditor, cursorPosition: vscode.Position) {
  if (!completionItems || completionItems.length === 0) {
    return;
  }

  if (currentIndex >= completionItems.length) {
    currentIndex = 0;
  }

  currentGhostText = completionItems[currentIndex]?.key || undefined;

  if (ghostTextDecorationType) {
    ghostTextDecorationType.dispose();
    ghostTextDecorationType = null;
  }

  // Ghost Text를 항상 커서 뒤에만 위치시키도록 설정
  const adjustedCursorPosition = cursorPosition.translate(0, 0); // 커서 위치 그대로

  ghostTextDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: currentGhostText,
      color: "rgba(128, 128, 128, 0.7)",
      fontStyle: "italic",
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen, // 수정: 커서 뒤에만 표시되도록
  });

  const decorationPosition = new vscode.Range(
    cursorPosition, // 커서 위치에서 시작
    cursorPosition // 동일 위치 유지
  );

  editor.setDecorations(ghostTextDecorationType, [
    { range: decorationPosition },
  ]);

  previousDecorationRange = decorationPosition;
}


// 명령 등록: 특정 키 조합을 눌렀을 때 인덱스 증가
const incrementCommand = vscode.commands.registerCommand(
  "extension.incrementCompletionIndex",
  () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const cursorPosition = editor.selection.active;

    // completionItems의 인덱스를 증가
    if (completionItems && completionItems.length > 0) {
      currentIndex = (currentIndex + 1) % completionItems.length;
      updateGhostText(editor, cursorPosition);
    }
  }
);

// 명령 등록
context.subscriptions.push(incrementCommand);

// 확장 종료 시 데코레이션 정리
context.subscriptions.push({
  dispose: () => {
    if (ghostTextDecorationType) {
      ghostTextDecorationType.dispose();
    }
  },
});


// 명령 등록: Ghost Text를 GPT에 전달하여 코드 생성
const generateFromGhostTextCommand = vscode.commands.registerCommand(
  "extension.generateFromGhostText",
  async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor found.");
      return;
    }

    if (!currentGhostText) {
      vscode.window.showWarningMessage("No Ghost Text available for GPT.");
      return;
    }

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating code from GPT...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Sending prompt to GPT..." });

        // 현재 문서의 언어 모드 확인
        const language = editor.document.languageId; // VSCode에서 문서 언어 가져오기
        console.log("Current language mode:", language);

        // 프롬프트 생성 (언어 모드 명시)
        const prompt = `Please generate the following code in C language:\n\n${currentGhostText}`;

        const gptResponse = await generativeAIcommunication(prompt);

        if (!gptResponse) {
          vscode.window.showErrorMessage("GPT did not return a valid response.");
          return;
        }

        progress.report({ message: "Updating Ghost Text..." });

        // GPT 응답을 Ghost Text로 설정
        currentGhostText = gptResponse.trim();
        console.log("GPT Response for Ghost Text:", currentGhostText);

        // GPT 응답을 Completion Items로 설정
        completionItems = [{ key: currentGhostText, value: 1, sortText: "0" }];
        console.log("Completion Items for Ghost Text:", completionItems);

        // Ghost Text 업데이트
        const cursorPosition = editor.selection.active;
        console.log("Calling updateGhostText...");
        updateGhostText(editor, cursorPosition);

        vscode.window.showInformationMessage("GPT response displayed as Ghost Text.");
      }
    );
  }
);

// 명령 등록
context.subscriptions.push(generateFromGhostTextCommand);

// 명령 등록: 특정 키를 눌렀을 때 gpt가 추천해준 Ghost Text를 삽입
const acceptGhostTextCommand = vscode.commands.registerCommand(
  "extension.acceptGhostText",
  () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor found.");
      return;
    }

    if (!currentGhostText) {
      vscode.window.showWarningMessage("No Ghost Text to accept.");
      return;
    }

    // Ghost Text 삽입 시 undefined 처리
    editor.edit((editBuilder) => {
      const cursorPosition = editor.selection.active;
      editBuilder.insert(cursorPosition, currentGhostText ?? ""); // undefined일 경우 빈 문자열로 대체
    });

    // Ghost Text 초기화
    clearGhostText();
    vscode.window.showInformationMessage("Ghost Text inserted into editor.");
  }
);

// 명령 등록
context.subscriptions.push(acceptGhostTextCommand);


 // Command that starts when you press the hot key
 // Gives a value to the server.
  const hotKeyProvider = vscode.commands.registerCommand(
    "extension.hotkey",
    () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (activeEditor) {
        // Get the document of the currently open editor
        const document = activeEditor.document;

        // Get cursor position
        const cursorPosition = activeEditor.selection.active;
        const cursorOffset = document.offsetAt(cursorPosition);

        const frontCursorTextLength = `${document.getText().length.toString()} True`;
        const frontCursorText = document.getText().substring(0, cursorOffset);
        const backCursorText = document.getText().substring(cursorOffset, document.getText().length);

        // Create an CSnippet Generator object with information to communicate with the server.
        const cSnippetGenerator = new CSnippetGenerator(
          frontCursorTextLength,
          frontCursorText,
          backCursorText
        );
        // Method to get CompletionItems
        cSnippetGenerator.getCompletionItems();

        // Methods that occur when you get CompletionItems
        cSnippetGenerator.onDataReceived((data: any) => {
          // c
          candidatesData = data;
          console.log("completionData : ", candidatesData);
          vscode.commands.executeCommand("extension.subhotkey");
        });
      } else {
        console.log("There are currently no open editors.");
      }
    }
  );

  // Command to test if TriggerSuggest is working properly
  let codeTrigger = vscode.commands.registerCommand(
    "extension.Triggertest",
    () => {
      vscode.commands.executeCommand("editor.action.triggerSuggest");
    }
  );

  // --- ChatGPT Code Completion Code ---
  let currentDocument: vscode.TextDocument | undefined = undefined;
  let disposable = vscode.commands.registerCommand(
    "extension.completeCode",
    async () => {
      const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath; // Get the first workspace folder path
      const untitledUri = vscode.Uri.parse(
        "untitled:" + path.join("SuggestedCode.c")
      ); // Generate a URI for an untitled document that will display the code
      const document = await vscode.workspace.openTextDocument(untitledUri); // Open or create a document from a URI
      const userEditor = vscode.window.activeTextEditor; // Get the active text editor that the user is 'currently working in'
      // Open a new text document (document, a temporary SuggestedCode.c file) next to the active text editor the user is 'working on'
      const newEditor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      });

      // If the current workspace is not open, an error message is displayed.
      if (!folderPath) {
        vscode.window.showErrorMessage("Workspace is not open");
        return;
      }

      // If the user has an active text editor that they are 'working on', get the code and pass it to the ChatGPT API.
      if (userEditor) {
        const document = userEditor.document;
        const entireText = document.getText(); // Get the entire contents (code) of the document.

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
          },
          async progress => {
            progress.report({
              message: "ChatGPT C Completion is generating code...",
            });
            const response = await generativeAIcommunication(entireText);
            progress.report({ message: "Updating editor now..." });

            // Code written on the side webview screen + response display
            await newEditor.edit(editBuilder => {
              // Delete all existing contents of the webview (initialize)
              const lastLine = newEditor.document.lineAt(
                newEditor.document.lineCount - 1
              );
              const range = new vscode.Range(
                new vscode.Position(0, 0),
                lastLine.range.end
              );
              editBuilder.delete(range);

              // Output newly received content to the webview
              editBuilder.insert(
                new vscode.Position(0, 0),
                "[Code entered]\n" +
                  entireText +
                  "\n\n" +
                  "==\n\n" +
                  "[Proposed Code]\n" +
                  response
              );
            });

            // Update results directly in the user screen editor
            await userEditor.edit(editBuilder => {
              // Delete all contents of the active editor
              const lastLine = document.lineAt(document.lineCount - 1);
              const range = new vscode.Range(
                new vscode.Position(0, 0),
                lastLine.range.end
              );
              editBuilder.delete(range);

              // Prints newly received content to the active editor
              editBuilder.insert(new vscode.Position(0, 0), "" + response);
            });

            progress.report({
              message:
                "ChatGPT C Completion has completed generating code!",
            });
            await new Promise(resolve => setTimeout(resolve, 2000)); // Output completion message for 2 seconds
            return;
          }
        );
      }
    }
  );

  // GPT가 코드를 생성해줄 때때 두번째로 호출되는 함수
  // --- Prompt Code ---
  const promptCommand = vscode.commands.registerCommand(
    "extension.subpromptkey",
    () => {
      // Delete existing Completion
      const disposable = vscode.Disposable.from(CompletionProvider);
      disposable.dispose();
      // Register a new Completion
      CompletionProvider = vscode.languages.registerCompletionItemProvider(
        ["c"],
        {
          async provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
          ):Promise<any> {
            const completionItems: vscode.CompletionItem[] = [];
            let scroll = 0;
            const maxScroll = 3;
            for (const { key, value, sortText } of candidatesData) {  // 후보 구문 리스트 중에 3개를 자르는 코드인듯.
              if (scroll >= maxScroll) { break;}
              // completion: means one candidate.
              const completion = new vscode.CompletionItem(key.trim());
              candidate_list.push(key.trim());
              console.log("Completion value ",scroll+1,":", completion);

              resulted_prefix = document.getText(
                new vscode.Range(new vscode.Position(0, 0), position)
              );
              console.log("Resulted Prefix:", resulted_prefix);
              // The value from the user's cursor position to the space. 
              // ex) If 'IF a = 10', it becomes 10. If 'IF a = 10 ', it becomes ''.
              const normalizedresulted_prefix = resulted_prefix.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s*=\s*/g, "=").replace(/\s*>\s*/g, ">").replace(/\s*<\s*/g, "<").trim();
              console.log("Normalized Resulted Prefix:", normalizedresulted_prefix);
              linePrefix = document
                .lineAt(position)
                .text.slice(0, position.character);
              console.log("Line Prefix:", linePrefix);
              const normalizedlinePrefix = linePrefix.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s*=\s*/g, "=").replace(/\s*>\s*/g, ">").replace(/\s*<\s*/g, "<").trim();
              console.log("Normalized Line Prefix:", normalizedlinePrefix);
              
              let responseText = await cSnippetGenerator?.getInsertText(completion.label, resulted_prefix);
              if (responseText){
                console.log("Original Response Text:", responseText);
                // Normalize the responseText in the same way (remove spaces inside the parentheses and spaces)
                const normalizedResponseText = responseText.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s*=\s*/g, "=").replace(/\s*>\s*/g, ">").replace(/\s*<\s*/g, "<").trim();
                console.log("Normalized Original Response Text:", normalizedResponseText);

                // "TextWindow" case and is present in the responseText
                if (normalizedresulted_prefix === "TextWindow" || normalizedresulted_prefix === "TextWindow.") {
                    responseText = normalizedResponseText.replace(normalizedresulted_prefix, '');
                    console.log("Updated Response Text in TextWindow case:", responseText);
                }
                // if Completion Label exists in the responseText
                if (typeof completion.label === "string" && responseText) {
                  const normalizedLabel = completion.label.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s*=\s*/g, "=").replace(/\s*>\s*/g, ">").replace(/\s*<\s*/g, "<").trim();
                  responseText = normalizedResponseText.replace(normalizedLabel, "").trimStart();
                  console.log("Updated Response After Candi Remove:", responseText);
                }
                // Remove the full prefix from the response text 
                if(normalizedResponseText.includes(normalizedresulted_prefix)){
                responseText = normalizedResponseText.replace(normalizedresulted_prefix, '');
                console.log("Response Text After Removing Full Matching Prefix:",responseText);
                }
                // Remove the line prefix from the response text 
                else if(normalizedResponseText.includes(normalizedlinePrefix)){
                  responseText = normalizedResponseText.replace(normalizedlinePrefix, '');
                  console.log("Response After Removing Line Matching Prefix:",responseText);
                }
                responseText = responseText.replace(/=/g, " = ").replace(/</g, " < ").replace(/>/g, " > ").trim();
                // Find the index of the first occurrence of ';' in responseText
                const semicolonIndex = responseText.indexOf(';');
                // If a semicolon is found, truncate the responseText up to that index
                if (semicolonIndex !== -1) {
                  responseText = responseText.slice(0, semicolonIndex + 1); // Include the semicolon
                }
                let trimmedKey = key.trim();
                // if (trimmedKey.length > 18) {
                //     trimmedKey = trimmedKey.substring(0, 10) + "..";
                // }
                let completionFinalText = new vscode.CompletionItem(responseText);
              // sortText to sort the phrase candidates by frequency
              completionFinalText.sortText = sortText;
              // Set the frequency for each phrase group to be output as Docs
              const completionDocs = new vscode.MarkdownString(
                trimmedKey
              );
              // Writing documentation for Completion
              completionFinalText.documentation = completionDocs;
              // Code suggestion Code to prevent filtering by prefix
              completionFinalText.filterText = linePrefix;
              completionItems.push(completionFinalText);
              console.log('Completed Suggestion: ', completionFinalText);
            }
            scroll++;
            }
            ``;
            return completionItems;
          },
          async resolveCompletionItem(item: vscode.CompletionItem) {
            // The content of the code written by the user so far should be included: resulted_prefix
            // This function is called when selected: selected item
            // The values ​​to be given to prompt: language, resulted_prefix, item
            console.log("Candidate List:");
            candidate_list.forEach(candidate => console.log(candidate));
            //console.log("Execute the resolve function for Prompt Code................");
            // In the case of Graphics.Window, only Window should be the prefix.
            // The area after the '.' position is taken as a prefix.
            const lastDotIndex = linePrefix.lastIndexOf(".");
            if (lastDotIndex !== -1) {
              linePrefix = linePrefix.slice(lastDotIndex + 1).trim();
            }
            if (linePrefix.includes('(')) { 
              linePrefix = "";
              console.log("Modified linePrefix after bracket:", linePrefix);
            }
            if (linePrefix.includes('=')) {
              // Get the text after the '=' symbol
              linePrefix = linePrefix.split('=')[1].trim();
              console.log("Modified linePrefix after '=' symbol:", linePrefix);
            }
            if (item && cSnippetGenerator !== null) {
              //console.log("item: ",item.label);
              // Remove Completion item from response text
              let extractedText = '';
              if (typeof item.label === 'string') {
                extractedText=item.label;
              }
              // let extractedText = '';
              // if (typeof item.label === 'string') {
              //   // Split and extract text based on '|'
              //   const labelParts = item.label.split('|').map(part => part.trim());
              //   if (labelParts.length > 1) {
              //       extractedText = labelParts[1]; // Text after '|'
              //       // Ensure the left part of the label is not included
              //       const leftPart = labelParts[0].replace(/\s+/g, ''); // Normalize by removing spaces
              //       const normalizedExtracted = extractedText.replace(/\s+/g, ''); // Normalize the extracted text
              //       if (normalizedExtracted.includes(leftPart)) {
              //           extractedText = extractedText
              //               .replace(new RegExp(leftPart.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), '')
              //               .trim();
              //       }
              //   }
              // } else if (typeof item.label === 'object') {
              //   console.error("CompletionItemLabel structure detected; please adjust extraction logic.");
              // }
              // console.log("Extracted Text: ", extractedText);
              const lastIndex = linePrefix.length - 1;
              let insertText: string | null;
              // console.log("linePrefix[lastIndex] = ", linePrefix[lastIndex]);
              // console.log("linePrefix : ", linePrefix);
              if (linePrefix[lastIndex] === " ") {
                insertText = extractedText;
              } else {
                insertText =linePrefix + extractedText;
              }
              if (insertText === null) {
                insertText = ""; //If insertText is null, set it to an empty string.
              }

              item.insertText = new vscode.SnippetString(insertText);
            }
            return item;
          },
        }
      );
      // Triggest Suggest Execution
      vscode.commands.executeCommand("editor.action.triggerSuggest");
    }
  );

  // Command that starts when you press the hot key
  // Gives a value to the server.
  // 첫 번째로 호출 되는 함수.
  // 키를 누를 때, 서버에 값을 준다. 이 값은 아마 구문 후보 리스트인듯 하다.
  // 원본 코드
  const PromptKeyProvider = vscode.commands.registerCommand(
    "extension.promptkey",
    () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (activeEditor) {
        // Get the document of the currently open editor
        const document = activeEditor.document;

        // Get cursor position
        const cursorPosition = activeEditor.selection.active;
        const cursorOffset = document.offsetAt(cursorPosition);

        const frontCursorTextLength = `${document.getText().length.toString()} True`;
        const frontCursorText = document.getText().substring(0, cursorOffset);
        const backCursorText = document
          .getText()
          .substring(cursorOffset, document.getText().length);

        // Create an CSnippet Generator object with information to communicate with the server.
        const cSnippetGenerator = new CSnippetGenerator(
          frontCursorTextLength,
          frontCursorText,
          backCursorText
        );

        // Method to get CompletionItems
        cSnippetGenerator.getCompletionItems();

        // Methods that occur when you get CompletionItems
        // cSnippetGenerator 가 구문 리스트를 서버(c11 parser)로부터 받아서 저장장
        cSnippetGenerator.onDataReceived((data: any) => {
          // c
          candidatesData = data;
          console.log("completionData : ", candidatesData);
          vscode.commands.executeCommand("extension.subpromptkey");
        });
      } else {
        console.log("There are currently no open editors.");
      }
    }
  );

  context.subscriptions.push(disposable);
  context.subscriptions.push(
    hotKeyProvider,
    completionCommand,
    codeTrigger,
    promptCommand,
    PromptKeyProvider
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}

