import { appEnv } from './app-env'
appEnv.init()

import { App as SlackApp, LogLevel } from '@slack/bolt'
import { LinkUnfurls } from '@slack/web-api'
import { logger } from './logger'
import { notionService } from './notion'

const slackApp = new SlackApp({
  token: appEnv.slackToken,
  signingSecret: appEnv.slackSigningSecret,
  logLevel: appEnv.isProduction ? LogLevel.ERROR : LogLevel.DEBUG,
})

// Remove &amp;, which & sometimes escaped to, perhaps due to a bug in Slack.
const sanitizeSlackLink = (url: string): string => {
  return url.replace(/amp;/g, '')
}

slackApp.event('link_shared', async ({ event, client }) => {
  let unfurls: LinkUnfurls = {}

  for (const link of event.links) {
    logger.debug(`handling ${link.url}`)
    if (!notionService.isNotionDomain(link.domain)) continue

    const url = new URL(sanitizeSlackLink(link.url))
    const notionPageId = notionService.getPageIdFromUrl(url)

    if (notionPageId == null) {
      logger.error(`PageId not found in ${url}`)
      continue
    }
    const [pageData, text] = await Promise.all([
      notionService.getPageData(notionPageId),
      notionService.getPageBody(notionPageId),
    ])
    // Note that the key of the unfurl must be the same as the URL shared on slack.)
    unfurls[link.url] = {
      title: pageData.title,
      text,
      title_link: link.url,
      footer: pageData.breadcrumbs.join(' / '),
      footer_icon:
        'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png',
      author_icon: pageData.author?.icon,
      author_link: pageData.author?.link,
      author_name: pageData.author?.name,
    }
  }
  await client.chat.unfurl({
    ts: event.message_ts,
    channel: event.channel,
    unfurls,
  })
})

const main = async () => {
  await slackApp.start({ port: appEnv.port, path: '/' })
  console.log(`⚡️ Bolt app is listening ${appEnv.port}`)
}

main()
