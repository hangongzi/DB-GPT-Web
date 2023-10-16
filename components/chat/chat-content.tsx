import { PropsWithChildren, ReactNode, memo, useContext, useMemo, useRef } from 'react';
import {
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  LinkOutlined,
  LoadingOutlined,
  RobotOutlined,
  SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import ReactMarkdown from 'react-markdown';
import { IChatDialogueMessageSchema } from '@/types/chat';
import rehypeRaw from 'rehype-raw';
import classNames from 'classnames';
import { Button, Image, Tag, message } from 'antd';
import { renderModelIcon } from './header/model-selector';
import { ChatContext } from '@/app/chat-context';
import copy from 'copy-to-clipboard';

interface Props {
  content: Omit<IChatDialogueMessageSchema, 'context'> & {
    context:
      | string
      | {
          template_name: string;
          template_introduce: string;
        };
  };
  isChartChat?: boolean;
  onLinkClick: () => void;
}

type MarkdownComponent = Parameters<typeof ReactMarkdown>['0']['components'];

type DBGPTView = {
  name: string;
  status: 'todo' | 'runing' | 'failed' | 'completed' | (string & {});
  result?: string;
  err_msg?: string;
};

const markdownComponents: MarkdownComponent = {
  code({ inline, node, className, children, style, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <div className="relative">
        <Button
          className="absolute right-3 top-2 text-gray-300 hover:!text-gray-200 bg-gray-700"
          type="text"
          icon={<CopyOutlined />}
          onClick={() => {
            const success = copy(children as string);
            message[success ? 'success' : 'error'](success ? 'Copy success' : 'Copy failed');
          }}
        />
        <SyntaxHighlighter language={match?.[1] ?? 'javascript'} style={oneDark}>
          {children as string}
        </SyntaxHighlighter>
      </div>
    ) : (
      <code {...props} style={style} className="px-[6px] py-[2px] rounded bg-gray-700 text-gray-100 dark:bg-gray-100 dark:text-gray-800 text-sm">
        {children}
      </code>
    );
  },
  ul({ children }) {
    return <ul className="py-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="py-1">{children}</ol>;
  },
  li({ children, ordered }) {
    return <li className={`text-sm leading-7 ml-5 pl-2 text-gray-600 dark:text-gray-300 ${ordered ? 'list-decimal' : 'list-disc'}`}>{children}</li>;
  },
  table({ children }) {
    return (
      <table className="my-2 rounded-tl-md rounded-tr-md max-w-full bg-white dark:bg-gray-900 text-sm rounded-lg overflow-hidden">{children}</table>
    );
  },
  thead({ children }) {
    return <thead className="bg-[#fafafa] dark:bg-black font-semibold">{children}</thead>;
  },
  th({ children }) {
    return <th className="!text-left p-4">{children}</th>;
  },
  td({ children }) {
    return <td className="p-4 border-t border-[#f0f0f0] dark:border-gray-700">{children}</td>;
  },
  h1({ children }) {
    return <h3 className="text-2xl font-bold my-4 border-b border-slate-300 pb-4">{children}</h3>;
  },
  h2({ children }) {
    return <h3 className="text-xl font-bold my-3">{children}</h3>;
  },
  h3({ children }) {
    return <h3 className="text-lg font-semibold my-2">{children}</h3>;
  },
  h4({ children }) {
    return <h3 className="text-base font-semibold my-1">{children}</h3>;
  },
  a({ children, href }) {
    return (
      <div className="inline-block text-blue-600 dark:text-blue-400">
        <LinkOutlined className="mr-1" />
        <a href={href} target="_blank">
          {children}
        </a>
      </div>
    );
  },
  img({ src, alt }) {
    return (
      <div>
        <Image
          className="min-h-[1rem] max-w-full max-h-full border rounded"
          src={src}
          alt={alt}
          placeholder={
            <Tag icon={<SyncOutlined spin />} color="processing">
              Image Loading...
            </Tag>
          }
          fallback="/images/fallback.png"
        />
      </div>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="py-4 px-6 border-l-4 border-blue-600 rounded bg-white my-2 text-gray-500 dark:bg-slate-800 dark:text-gray-200 dark:border-white shadow-sm">
        {children}
      </blockquote>
    );
  },
};

const pluginViewStatusMapper: Record<DBGPTView['status'], { bgClass: string; icon: ReactNode }> = {
  todo: {
    bgClass: 'bg-gray-500',
    icon: <ClockCircleOutlined className="ml-2" />,
  },
  runing: {
    bgClass: 'bg-blue-500',
    icon: <LoadingOutlined className="ml-2" />,
  },
  failed: {
    bgClass: 'bg-red-500',
    icon: <CloseOutlined className="ml-2" />,
  },
  completed: {
    bgClass: 'bg-green-500',
    icon: <CheckOutlined className="ml-2" />,
  },
};

function formatMarkdownVal(val: string) {
  return val
    .replaceAll('\\n', '\n')
    .replace(/<table(\w*=[^>]+)>/gi, '<table $1>')
    .replace(/<tr(\w*=[^>]+)>/gi, '<tr $1>');
}

function ChatContent({ children, content, isChartChat, onLinkClick }: PropsWithChildren<Props>) {
  const { scene } = useContext(ChatContext);

  const { context, model_name, role } = content;
  const isRobot = role === 'view';

  const { relations, value, cachePlguinContext } = useMemo<{ relations: string[]; value: string; cachePlguinContext: DBGPTView[] }>(() => {
    if (typeof context !== 'string') {
      return {
        relations: [],
        value: '',
        cachePlguinContext: [],
      };
    }
    const [value, relation] = context.split('\trelations:');
    const relations = relation ? relation.split(',') : [];
    const cachePlguinContext: DBGPTView[] = [];

    let cacheIndex = 0;
    const result = value.replace(/<dbgpt-view[^>]*>[^<]*<\/dbgpt-view>/gi, (matchVal) => {
      try {
        const pluginVal = matchVal.replace(/<[^>]*>|<\/[^>]*>/gm, '');
        const pluginContext = JSON.parse(pluginVal) as DBGPTView;
        const replacement = `<custom-view>${cacheIndex}</custom-view>`;

        cachePlguinContext.push({
          ...pluginContext,
          result: formatMarkdownVal(pluginContext.result ?? ''),
        });
        cacheIndex++;

        return replacement;
      } catch (e) {
        console.log((e as any).message);
        return matchVal;
      }
    });
    return {
      relations,
      cachePlguinContext,
      value: result,
    };
  }, [context]);

  const extraMarkdownComponents = useMemo<MarkdownComponent>(
    () => ({
      'custom-view'({ children }) {
        const index = +children.toString();
        if (!cachePlguinContext[index]) {
          return children;
        }
        const { name, status, err_msg, result } = cachePlguinContext[index];
        const { bgClass, icon } = pluginViewStatusMapper[status] ?? {};
        return (
          <div className="bg-white dark:bg-[#212121] rounded-lg overflow-hidden my-2 flex flex-col lg:max-w-[80%]">
            <div className={classNames('flex px-4 md:px-6 py-2 items-center text-white text-sm', bgClass)}>
              {name}
              {icon}
            </div>
            {result ? (
              <div className="px-4 md:px-6 py-4 text-sm">
                <ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeRaw]}>
                  {result ?? ''}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="px-4 md:px-6 py-4 text-sm">{err_msg}</div>
            )}
          </div>
        );
      },
    }),
    [context, cachePlguinContext],
  );

  return (
    <div
      className={classNames('relative flex flex-wrap w-full px-2 sm:px-4 py-2 sm:py-6 rounded-xl break-words', {
        'bg-slate-100 dark:bg-[#353539]': isRobot,
        'lg:w-full xl:w-full pl-0': ['chat_with_db_execute', 'chat_dashboard'].includes(scene),
      })}
    >
      <div className="mr-2 flex flex-shrink-0 items-center justify-center h-7 w-7 rounded-full text-lg sm:mr-4">
        {isRobot ? renderModelIcon(model_name) || <RobotOutlined /> : <UserOutlined />}
      </div>
      <div className="flex-1 overflow-hidden items-center text-md leading-8">
        {/* User Input */}
        {!isRobot && typeof context === 'string' && context}
        {/* Render Report */}
        {isRobot && isChartChat && typeof context === 'object' && (
          <div>
            {`[${context.template_name}]: `}
            <span className="text-[#1677ff] cursor-pointer" onClick={onLinkClick}>
              <CodeOutlined className="mr-1" />
              {context.template_introduce || 'More Details'}
            </span>
          </div>
        )}
        {/* Markdown */}
        {isRobot && typeof context === 'string' && (
          <ReactMarkdown components={{ ...markdownComponents, ...extraMarkdownComponents }} rehypePlugins={[rehypeRaw]}>
            {formatMarkdownVal(value)}
          </ReactMarkdown>
        )}
        {!!relations?.length && (
          <div className="flex flex-wrap mt-2">
            {relations?.map((value, index) => (
              <Tag color="#108ee9" key={value + index}>
                {value}
              </Tag>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export default memo(ChatContent);
