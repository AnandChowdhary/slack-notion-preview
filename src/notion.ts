import { Client } from '@notionhq/client'
import {
  GetBlockResponse,
  GetPageResponse,
} from '@notionhq/client/build/src/api-endpoints'
import { appEnv } from './app-env'
import { logger } from './logger'
import { getLastElement } from './utils'

export const notionClient = new Client({
  auth: appEnv.notionToken,
})

const INDENT = '    '
const NEWLINE = '\n'

export const notionService = {
  async getPageData(
    pageId: string,
    options = {
      breadcrumbsDepth: 2,
    }
  ): Promise<{
    title: string
    breadcrumbs: string[]
    author?: { name: string; link: string; icon: string }
  }> {
    const page = await notionClient.pages.retrieve({ page_id: pageId })
    return {
      title: helper.getPageTitle(page, { emoji: true }),
      author: await helper.getPageAuthor(page),
      breadcrumbs: await helper.getPageBreadcrumbs(page, options),
    }
  },

  async getPageBody(
    pageId: string,
    options = {
      blockCount: 20,
      indent: 0,
      depth: 3,
    }
  ): Promise<string> {
    const blocks = await notionClient.blocks.children.list({
      block_id: pageId,
    })

    let text = ''
    for (const block of blocks.results.slice(0, options.blockCount)) {
      const blockContent = helper.getBlockContent(block)
      if (blockContent.length > 0) {
        text += INDENT.repeat(options.indent)
        text += blockContent.trim()
        text += NEWLINE
      }

      // Retrieving children content
      if ('has_children' in block && block.has_children && options.depth > 0) {
        text += await this.getPageBody(block.id, {
          blockCount: options.blockCount,
          indent: options.indent + 1,
          depth: options.depth - 1,
        })
      }
    }
    return text
  },

  isNotionDomain: (domain: string): boolean => {
    return domain.match(/(www\.)?notion.so/) != null
  },

  getPageIdFromUrl: (url: URL): string | undefined => {
    // In case of modal display, pageId is in query 'p'.
    // e.g. https://www.notion.so/example/my-title-571bb99b29e040eb8a46c2f9b7d138af?p=5daca1bba9ce4ed0bf7a5d348ac9a81d
    const queryId = url.searchParams.get('p')
    if (queryId != null) {
      return queryId
    }

    // In case of page display, pageId is the terminal part of the path separated by '-'.
    // e.g. https://www.notion.so/example/my-title-571bb99b29e040eb8a46c2f9b7d138af
    const pathLast = getLastElement(url.pathname.split('/'))
    return getLastElement(pathLast?.split('-') ?? [])
  },
}

const helper = {
  getPageTitle(page: GetPageResponse, opts?: { emoji: boolean }): string {
    let title = ''
    // Descriminating union
    if (!('properties' in page)) {
      logger.error(`properties not found in ${page}`)
      return title
    }
    for (const property of Object.values(page.properties)) {
      // Descriminating union
      if (property.type !== 'title') continue
      title = property.title.map(x => x.plain_text).join('')
      if (opts && opts.emoji && page.icon && page.icon.type === 'emoji')
        title = page.icon.emoji + ' ' + title
    }
    return title
  },

  async getPageAuthor(
    page: GetPageResponse
  ): Promise<undefined | { name: string; link: string; icon: string }> {
    if (!('properties' in page)) {
      logger.error(`properties not found in ${page}`)
      return
    }
    if (page.last_edited_by && page.last_edited_by.id) {
      logger.log(`got user id ${page.last_edited_by.id}`)
      const user = await notionClient.users.retrieve({
        user_id: page.last_edited_by.id,
      })
      logger.log(`got user details ${user.name}`)
      return {
        name: user.name || 'Unknown user',
        link:
          'https://pabio.com/about/team/' +
          (user.name || '').split(' ')[0].toLowerCase() +
          '/',
        icon:
          user.avatar_url ||
          'https://upload.wikimedia.org/wikipedia/commons/9/99/Sample_User_Icon.png',
      }
    }
  },

  async getPageBreadcrumbs(
    page: GetPageResponse,
    options = { breadcrumbsDepth: 2 }
  ): Promise<string[]> {
    if (options.breadcrumbsDepth <= 0) {
      return []
    }
    // Descriminating union
    if (!('parent' in page)) {
      logger.error(`parent not found in ${page}`)
      return []
    }

    let breadcrumbs: string[] = [this.getPageTitle(page)]

    // Retrieving breadcrumbs
    if (page.parent.type === 'database_id') {
      const parentData = await this.getDatabaseData(page.parent.database_id, {
        breadcrumbsDepth: options.breadcrumbsDepth - 1,
      })
      breadcrumbs = parentData.breadcrumbs.concat(breadcrumbs)
    }
    if (page.parent.type === 'page_id') {
      const parentData = await notionService.getPageData(page.parent.page_id, {
        breadcrumbsDepth: options.breadcrumbsDepth - 1,
      })
      breadcrumbs = parentData.breadcrumbs.concat(breadcrumbs)
    }
    return breadcrumbs
  },

  async getDatabaseData(
    databaseId: string,
    options = {
      breadcrumbsDepth: 2,
    }
  ): Promise<{ breadcrumbs: string[] }> {
    const database = await notionClient.databases.retrieve({
      database_id: databaseId,
    })

    // Descriminating union
    if (!('parent' in database)) {
      logger.error(`parent not found in ${database}`)
      return { breadcrumbs: [] }
    }

    if (database.parent.type !== 'page_id' || options.breadcrumbsDepth <= 0) {
      return { breadcrumbs: [] }
    }

    const parentData = await notionService.getPageData(
      database.parent.page_id,
      {
        // Database name is not included in breadcrumbs, so do not change the depth.
        breadcrumbsDepth: options.breadcrumbsDepth,
      }
    )
    return { breadcrumbs: parentData.breadcrumbs }
  },

  getBlockContent(block: GetBlockResponse): string {
    if (!('type' in block)) return ''
    switch (block.type) {
      case 'paragraph':
        return block.paragraph.rich_text.map(x => x.plain_text).join('')

      case 'heading_1':
        return (
          '*' + block.heading_1.rich_text.map(x => x.plain_text).join('') + '*'
        )

      case 'heading_2':
        return (
          '*' + block.heading_2.rich_text.map(x => x.plain_text).join('') + '*'
        )

      case 'heading_3':
        return (
          '*' + block.heading_3.rich_text.map(x => x.plain_text).join('') + '*'
        )

      case 'to_do':
        const checkMark = block.to_do.checked ? 'x' : ' '
        return (
          `- [${checkMark}] ` +
          block.to_do.rich_text.map(x => x.plain_text).join('')
        )

      case 'bulleted_list_item':
        return (
          '・' +
          block.bulleted_list_item.rich_text.map(x => x.plain_text).join('')
        )

      case 'numbered_list_item':
        // TODO: We should give sequential numbers for numbered list
        return (
          '・' +
          block.numbered_list_item.rich_text.map(x => x.plain_text).join('')
        )

      default:
        logger.debug(`Unsupported type: ${block.type}`)
        return ''
    }
  },
}
