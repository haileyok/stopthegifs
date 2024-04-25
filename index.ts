import {
  AppBskyEmbedExternal,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedPost,
  BskyAgent,
} from '@atproto/api'
import * as dotenv from 'dotenv'
import {ComAtprotoSyncSubscribeRepos, subscribeRepos, SubscribeReposMessage} from 'atproto-firehose'

dotenv.config()

let queueInterval: NodeJS.Timeout | undefined = undefined
const queue = new Set<{uri: string, cid: string, label: 'tenor-gif' | 'tenor-gif-no-text'}>()

const agent = new BskyAgent({
  service: 'https://bsky.social/',
})

const login = async () => {
  await agent.login({
    identifier: process.env.BSKY_HANDLE ?? '',
    password: process.env.BSKY_PASSWORD ?? '',
  })
}

const emitLabel = async (uri: string, cid: string, label: 'tenor-gif' | 'tenor-gif-no-text') => {
  try {
    await agent.withProxy('atproto_labeler', 'did:plc:mjyeurqmqjeexbgigk3yytvb').api.tools.ozone.moderation.emitEvent({
      event: {
        $type: 'tools.ozone.moderation.defs#modEventLabel',
        createLabelVals: [label],
        negateLabelVals: [],
      },
      subject: {
        $type: 'com.atproto.repo.strongRef',
        uri,
        cid,
      },
      createdBy: agent.session?.did ?? '',
      createdAt: new Date().toISOString(),
      subjectBlobCids: [],
    })

    console.log(`Emitted label for ${uri} with ${cid} using label ${label}`)
  } catch (e: any) {
    console.log('Failed to emit label. Taking a break 🥵')
    clearInterval(queueInterval)

    setTimeout(() => {
      queueInterval = setInterval(processLabel, 20)
    }, 15e3)
  }
}

const handleMessage =  (message: SubscribeReposMessage): void => {
    if (ComAtprotoSyncSubscribeRepos.isCommit(message)) {
      const repo = message.repo
      const op = message.ops[0]

      if (!AppBskyFeedPost.isRecord(op?.payload)) {
        return
      }

      const uri = `at://${repo}/${op.path}`
      const cid = op.cid?.toString()

      if (!cid) return

      try {
        if (AppBskyEmbedExternal.isMain(op.payload.embed) && op.payload.embed.external.uri.includes("media.tenor.com")) {
          if (!op.payload.text || op.payload.text === '') {
            queue.add({uri, cid, label: 'tenor-gif-no-text'})
          }
          queue.add({uri, cid, label: 'tenor-gif'})
        }
      } catch(e) {
        console.log('Failed on regular')
        console.log(uri)
      }

      try {
        // @ts-ignore I'm lazy here
        if (AppBskyEmbedRecordWithMedia.isMain(op.payload.embed) && op.payload.embed.media.external?.uri.includes("media.tenor.com")) {
          if (!op.payload.text || op.payload.text === '') {
            queue.add({uri, cid, label: 'tenor-gif-no-text'})
          }
          queue.add({uri, cid, label: 'tenor-gif'})
        }
      } catch(e) {
        console.log('Failed on other')
        console.log(uri)
      }
    }
}

const processLabel = async () => {
  const next = queue.values().next().value
  if (!next) return

  emitLabel(next.uri, next.cid, next.label)
  queue.delete(next)
}

const run = async () => {
  await login()

  const firehose = subscribeRepos('wss://bsky.network', {
    decodeRepoOps: true,
  })
  firehose.on('message', handleMessage)

  queueInterval = setInterval(processLabel, 20)
}

run()
